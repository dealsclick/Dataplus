import { Alert,AlertDescription,AlertTitle } from "@/components/ui/alert"
import { AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card,CardContent,CardDescription,CardFooter,CardHeader,CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible,CollapsibleContent,CollapsibleTrigger } from "@/components/ui/collapsible"
import { Command,CommandEmpty,CommandGroup,CommandInput,CommandItem,CommandList,CommandSeparator } from "@/components/ui/command"
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { FieldDescription,FieldLabel,Field as FormField } from "@/components/ui/field"
import { HoverCard,HoverCardContent,HoverCardTrigger } from "@/components/ui/hover-card"
import { Input } from "@/components/ui/input"
import { InputGroup,InputGroupAddon,InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Popover,PopoverContent,PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Sheet,SheetContent,SheetDescription,SheetFooter,SheetHeader,SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Tabs,TabsContent,TabsList,TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip,TooltipContent,TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ChevronDown,
  Copy,
  Database,
  ExternalLink,
  History,
  Link2,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  PackageSearch,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Store,
  Truck,
  Warehouse,
  X
} from "lucide-react"
import { lazy,useEffect,useMemo,useState } from "react"
import { toast } from "sonner"
import type {
  CatalogItem,
  ChannelConnection,
  ChannelLogEntry,
  ImportJob,
  ProductItem,
  ShopifyWarehouseMapping,
  SupplierCoverageEntry,
  SupplierCoverageResponse,
  Vendor,
  VendorFeedSchedule,
  VendorSupplierLocation
} from "../App"
import {
  jobStatusTone,
  launchWalmartExisting,
  returnToPreviousLocation,
  scheduleDescription
} from "../App"
import { loadAppReferences } from "../lib/app-state"
import { catalogChannelState,ebayListingOperatorState,marketplaceListingUrl } from "../lib/catalog-channel-utils"
import { api,dateLabel,moneyLabel,numberLabel } from "../lib/client-api"
import { Detail,Field } from "./app-ui"
import { shipmentDisplayValue,trackingUrlForShipment } from "./shipment-links"

function emptyVendorSupplierLocation(priority: number): VendorSupplierLocation {
  const now = new Date().toISOString()
  return {
    id: globalThis.crypto?.randomUUID?.() || `supplier-location-${Date.now()}`,
    code: "",
    name: "",
    status: "active",
    address: { line1: "", line2: "", city: "", state: "", postalCode: "", country: "US" },
    timezone: "America/New_York",
    dropshipEnabled: false,
    inventoryEnabled: true,
    priority,
    leadTimeDays: 0,
    cutoffTime: "",
    safetyQtyEnabled: false,
    safetyQty: null,
    freshnessHours: 24,
    sourceLocationIds: [],
    notes: "",
    createdAt: now,
    updatedAt: now,
  }
}

const WalmartListingStatus = lazy(() => import("./walmart-listing-status").then((module) => ({ default: module.WalmartListingStatus })))
const WalmartLaunch = lazy(() => import("./walmart-launch").then((module) => ({ default: module.WalmartLaunch })))
const WalmartUpcMatch = lazy(() => import("./walmart-upc-match").then((module) => ({ default: module.WalmartUpcMatch })))
const WalmartReadiness = lazy(() => import("./walmart-upc-match").then((module) => ({ default: module.WalmartReadiness })))
const WalmartCatalogMatch = lazy(() => import("./walmart-upc-match").then((module) => ({ default: module.WalmartCatalogMatch })))

export function MetricCard({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string | number
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card id="vendor-feed-schedules">
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

export function VendorFeedScheduleManager({ vendors, vendor, dataSource, jobs = [], onSelectJob, onSaveVendorLocations }: { vendors: Vendor[]; vendor?: Vendor; dataSource?: boolean; jobs?: ImportJob[]; onSelectJob?: (job: ImportJob) => void; onSaveVendorLocations?: (locations: VendorSupplierLocation[]) => Promise<void> }) {
  const [feeds, setFeeds] = useState<VendorFeedSchedule[]>([])
  const [mappingTemplates, setMappingTemplates] = useState<Array<{ id: string; name: string; mode?: string }>>([])
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [draft, setDraft] = useState<VendorFeedSchedule | null>(null)
  const [notesFeed, setNotesFeed] = useState<VendorFeedSchedule | null>(null)
  const [notesDraft, setNotesDraft] = useState("")
  const [createLocation, setCreateLocation] = useState(false)
  const [newLocationName, setNewLocationName] = useState("")
  const [newLocationCode, setNewLocationCode] = useState("")

  const loadFeeds = async () => {
    try {
      const result = await api<{ feeds: VendorFeedSchedule[] }>(dataSource ? "/api/data-source-feeds" : "/api/vendor-feed-schedules")
      setFeeds(result.feeds || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load vendor feeds.")
    }
  }

  useEffect(() => {
    void loadFeeds()
    void api<{ exportMappings: Array<{ id: string; name: string; mode?: string }> }>("/api/export-mappings")
      .then((result) => setMappingTemplates((result.exportMappings || []).filter((template) => ["import", "both"].includes(String(template.mode || "both").toLowerCase()))))
      .catch(() => setMappingTemplates([]))
  }, [])

  const visibleFeeds = vendor ? feeds.filter((feed) => String(feed.vendorId || "") === vendor.id) : feeds
  const jobById = new Map(jobs.map((job) => [job.id, job]))

  const openNew = () => {
    const activeLocations = (vendor?.supplierLocations || []).filter((location) => location.status === "active")
    setDraft({
      id: "",
      name: "",
      vendorId: vendor?.id || "",
      vendorName: dataSource ? "DataWarehouse" : (vendor?.name || ""),
      supplierLocationId: activeLocations.length === 1 ? activeLocations[0].id : "",
      enabled: dataSource,
      transport: "ftp",
      ftpPort: 21,
      ftpHost: "",
      ftpUsername: "",
      ftpPassword: "",
      ftpRemotePath: "",
      fileFormat: "bson-gzip",
      importTarget: "source-catalog",
      mappingProfile: "source-catalog-standard",
      syncMode: "split",
      notes: "",
      scheduleType: "times",
      scheduleTimes: "02:00",
      scheduleEveryHours: 24,
      refreshEnabled: true,
      refreshScheduleType: "times",
      refreshScheduleTimes: "02:00",
      refreshScheduleEveryHours: 24,
      fullImportEnabled: false,
      fullImportScheduleType: "times",
      fullImportScheduleTimes: "01:00",
      fullImportScheduleEveryHours: 24,
    })
    setCreateLocation(Boolean(vendor && !dataSource && activeLocations.length === 0))
    setNewLocationName("")
    setNewLocationCode("")
    setOpen(true)
  }

  const saveDraft = async () => {
    if (!draft?.name?.trim()) return toast.error("Enter a name for this vendor feed.")
    setSaving(true)
    try {
      let nextDraft = draft
      if (vendor && !dataSource) {
        if (createLocation) {
          const name = newLocationName.trim()
          const code = newLocationCode.trim()
          if (!name || !code) throw new Error("Enter a location name and code.")
          if ((vendor.supplierLocations || []).some((location) => location.code.toLowerCase() === code.toLowerCase())) throw new Error("That supplier location code already exists.")
          if (!onSaveVendorLocations) throw new Error("Supplier locations cannot be updated from this page.")
          const location = { ...emptyVendorSupplierLocation((vendor.supplierLocations || []).length + 1), name, code }
          await onSaveVendorLocations([...(vendor.supplierLocations || []), location])
          nextDraft = { ...draft, supplierLocationId: location.id }
        } else if (!draft.supplierLocationId) {
          throw new Error("Select a supplier location or create one for this feed.")
        }
      }
      const next = nextDraft.id ? feeds.map((feed) => feed.id === nextDraft.id ? nextDraft : feed) : [...feeds, nextDraft]
      const result = await api<{ feeds: VendorFeedSchedule[] }>(dataSource ? "/api/data-source-feeds" : "/api/vendor-feed-schedules", { method: "PUT", body: JSON.stringify({ feeds: next }) })
      setFeeds(result.feeds || [])
      setOpen(false)
      setDraft(null)
      toast.success("Vendor feed saved.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save vendor feed.")
    } finally {
      setSaving(false)
    }
  }

  const runFeed = async (feed: VendorFeedSchedule, mode: "full" | "refresh" = "refresh") => {
    try {
      const endpoint = `${dataSource ? "/api/data-source-feeds" : "/api/vendor-feed-schedules"}/${encodeURIComponent(feed.id)}/run${dataSource ? `?mode=${mode}` : ""}`
      const result = await api<{ message?: string }>(endpoint, { method: "POST" })
      toast.success(result.message || `${feed.name} queued.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue vendor feed.")
    }
  }

  const setDraftValue = (field: keyof VendorFeedSchedule, value: unknown) => setDraft((current) => current ? { ...current, [field]: value } : current)

  const saveFeedNotes = async () => {
    if (!notesFeed) return
    setSaving(true)
    try {
      const next = feeds.map((feed) => feed.id === notesFeed.id ? { ...feed, notes: notesDraft } : feed)
      const result = await api<{ feeds: VendorFeedSchedule[] }>(dataSource ? "/api/data-source-feeds" : "/api/vendor-feed-schedules", { method: "PUT", body: JSON.stringify({ feeds: next }) })
      setFeeds(result.feeds || [])
      setNotesFeed(null)
      toast.success("Feed notes saved.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save feed notes.")
    } finally { setSaving(false) }
  }

  const testConnection = async () => {
    if (!draft) return
    setTesting(true)
    try {
      const result = await api<{ message?: string }>(dataSource ? "/api/data-source-feeds/test" : "/api/vendor-feed-schedules/test", { method: "POST", body: JSON.stringify({ feed: draft }) })
      toast.success(result.message || "FTP connection verified.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "FTP connection test failed.")
    } finally {
      setTesting(false)
    }
  }

  return (
    <Card>
      <CardHeader className="border-b py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><CardTitle className="text-base">{dataSource ? "Universal data sources" : vendor ? "Source catalog feed" : "Scheduled vendor feeds"}</CardTitle><CardDescription>{dataSource ? "Third-party feeds containing records for many suppliers. DataWarehouse belongs here, not on a vendor profile." : vendor ? "This supplier's FTP connection, mapping, and import timing. Jobs runs it automatically after it is enabled." : "A live register of vendor-owned scheduled feeds. Configure a connection from the supplier profile."}</CardDescription></div>
          {(vendor || dataSource) ? <Button size="sm" onClick={openNew}><Database className="size-4" /> Add {dataSource ? "source" : "feed"}</Button> : null}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Feed</TableHead><TableHead>Supplier</TableHead><TableHead>Source</TableHead><TableHead>Mapping</TableHead><TableHead>Schedule</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
          {visibleFeeds.map((feed) => {
            const lastJob = feed.lastJobId ? jobById.get(feed.lastJobId) : undefined
            return <TableRow key={feed.id}>
            <TableCell><p className="font-medium">{feed.name}</p><p className="text-xs text-muted-foreground">{feed.lastJobId ? `Last job ${feed.lastJobId.slice(0, 8)}` : "Not run yet"}</p></TableCell>
            <TableCell>{dataSource ? (feed.vendorName || "DataWarehouse") : <div><p>{feed.vendorName || "Unassigned"}</p><p className="text-xs text-muted-foreground">{vendor?.supplierLocations?.find((location) => location.id === feed.supplierLocationId)?.name || "Location not linked"}</p></div>}</TableCell>
            <TableCell className="max-w-52 truncate text-sm">{feed.ftpHost ? `FTP ${feed.ftpHost}${feed.ftpRemotePath || ""}` : "Connection not configured"}</TableCell>
            <TableCell className="max-w-60 truncate text-sm" title={feed.mappingProfile === "source-catalog-standard" ? "Source catalog standard" : mappingTemplates.find((template) => template.id === feed.mappingProfile)?.name || "Not selected"}>{feed.mappingProfile === "source-catalog-standard" ? "Source catalog standard" : mappingTemplates.find((template) => template.id === feed.mappingProfile)?.name || "Not selected"}</TableCell>
            <TableCell className="text-sm">{dataSource ? <div className="space-y-1"><p>Refresh: {scheduleDescription(feed.refreshScheduleType || feed.scheduleType, feed.refreshScheduleTimes || feed.scheduleTimes, feed.refreshScheduleEveryHours || feed.scheduleEveryHours, "02:00")}</p><p className="text-xs text-muted-foreground">Full: {scheduleDescription(feed.fullImportScheduleType, feed.fullImportScheduleTimes, feed.fullImportScheduleEveryHours, "01:00")}</p></div> : scheduleDescription(feed.scheduleType, feed.scheduleTimes, feed.scheduleEveryHours, "02:00")}</TableCell>
            <TableCell><div className="flex min-w-32 flex-col items-start gap-1">{dataSource ? <><Badge variant={feed.refreshEnabled ? "success" : "outline"}>Refresh {feed.refreshEnabled ? "enabled" : "disabled"}</Badge><Badge variant={feed.fullImportEnabled ? "info" : "outline"}>Full {feed.fullImportEnabled ? "enabled" : "manual"}</Badge></> : <Badge variant={feed.enabled ? "success" : "outline"}>{feed.enabled ? "Enabled" : "Disabled"}</Badge>}{lastJob ? <button type="button" className="text-left text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => onSelectJob?.(lastJob)} title={`Open job ${lastJob.id}`}><span className="capitalize">{lastJob.status || "queued"}</span> / {dateLabel(lastJob.finishedAt || lastJob.updatedAt || lastJob.startedAt)}</button> : feed.lastJobId ? <span className="text-xs text-muted-foreground">Latest run is outside this history page.</span> : null}</div></TableCell>
            <TableCell><div className="flex justify-end gap-2"><Button size="icon" variant={feed.notes ? "secondary" : "ghost"} title="View feed notes" onClick={() => { setNotesFeed(feed); setNotesDraft(String(feed.notes || "")) }}><MessageSquare className="size-4" /></Button>{(vendor || dataSource) ? <><Button size="sm" variant="outline" onClick={() => { setDraft({ ...feed, ftpPassword: "" }); setCreateLocation(false); setNewLocationName(""); setNewLocationCode(""); setOpen(true) }}>Edit</Button>{dataSource ? <><Button size="sm" variant="outline" onClick={() => void runFeed(feed, "full")} disabled={!feed.ftpHost || !feed.ftpUsername || !feed.ftpPasswordConfigured}>Run full</Button><Button size="sm" onClick={() => void runFeed(feed, "refresh")} disabled={!feed.ftpHost || !feed.ftpUsername || !feed.ftpPasswordConfigured}>Run refresh</Button></> : <Button size="sm" onClick={() => void runFeed(feed)} disabled={!feed.ftpHost || !feed.ftpUsername || !feed.ftpPasswordConfigured || !feed.supplierLocationId}>Run now</Button>}</> : <Button size="sm" variant="outline" asChild><a href={feed.vendorId ? `/vendors/${encodeURIComponent(feed.vendorId)}` : "/settings?tab=data-sources"}>{feed.vendorId ? "Open supplier" : "Open source"}</a></Button>}</div></TableCell>
          </TableRow>
          })}
          {!visibleFeeds.length && <TableRow><TableCell colSpan={7} className="h-28 text-center text-muted-foreground">{dataSource ? "No universal source is configured." : vendor ? "No feed is configured for this supplier." : "No vendor feeds are scheduled. Open a supplier profile to configure its source-catalog feed."}</TableCell></TableRow>}
        </TableBody></Table></div>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[92dvh] w-[calc(100%-1rem)] max-w-[calc(100%-1rem)] flex-col overflow-hidden p-0 sm:!max-w-5xl">
          <DialogHeader className="shrink-0 border-b px-5 py-4"><DialogTitle>{draft?.id ? "Edit vendor feed" : "Add vendor feed"}</DialogTitle><DialogDescription>Connect the FTP source to the supplier location that owns its inventory. Credentials remain server-side.</DialogDescription></DialogHeader>
          <ScrollArea className="min-h-0 flex-1">
          {draft && <div className="grid gap-4 p-5 md:grid-cols-2">
            <div className="grid gap-2"><Label>Feed name</Label><Input value={draft.name} onChange={(event) => setDraftValue("name", event.target.value)} placeholder="Product datadump" /></div>
            {dataSource ? <div className="grid gap-2"><Label>Source name</Label><Input value={draft.vendorName || "DataWarehouse"} onChange={(event) => setDraftValue("vendorName", event.target.value)} /></div> : vendor ? <div className="grid gap-2"><Label>Supplier</Label><Input value={vendor.name} disabled /></div> : <div className="grid gap-2"><Label>Supplier</Label><Select value={draft.vendorId || "none"} onValueChange={(value) => { const selectedVendor = vendors.find((item) => item.id === value); setDraft((current) => current ? { ...current, vendorId: value === "none" ? "" : value, vendorName: value === "none" ? "" : selectedVendor?.name || "" } : current) }}><SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger><SelectContent><SelectItem value="none">No supplier selected</SelectItem>{vendors.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>}
            {vendor && !dataSource ? <div className="grid gap-3 rounded-md border bg-muted/20 p-3 md:col-span-2">
              <div><Label>Supplier location</Label><p className="mt-1 text-xs text-muted-foreground">Every direct feed belongs to one supplier location so inventory keeps its source and fulfillment context.</p></div>
              <Select value={createLocation ? "__create__" : (draft.supplierLocationId || "none")} onValueChange={(value) => { if (value === "__create__") { setCreateLocation(true); setDraftValue("supplierLocationId", "") } else { setCreateLocation(false); setDraftValue("supplierLocationId", value === "none" ? "" : value) } }}>
                <SelectTrigger><SelectValue placeholder="Select supplier location" /></SelectTrigger>
                <SelectContent><SelectItem value="none">Select a location</SelectItem>{(vendor.supplierLocations || []).map((location) => <SelectItem key={location.id} value={location.id}>{location.name} ({location.code}){location.status === "inactive" ? " - inactive" : ""}</SelectItem>)}<SelectItem value="__create__">+ Create a new supplier location</SelectItem></SelectContent>
              </Select>
              {createLocation ? <div className="grid gap-3 rounded-md border bg-background p-3 sm:grid-cols-2"><Field label="New location name"><Input value={newLocationName} onChange={(event) => setNewLocationName(event.target.value)} placeholder="Harrisburg distribution center" /></Field><Field label="Location code"><Input value={newLocationCode} onChange={(event) => setNewLocationCode(event.target.value)} placeholder="HAR" /></Field><p className="text-xs text-muted-foreground sm:col-span-2">The location is created when you save this feed. Add address, safety, and fulfillment rules later from the supplier's Inventory tab.</p></div> : null}
            </div> : null}
            <div className="grid gap-2"><Label>FTP host</Label><Input value={draft.ftpHost || ""} onChange={(event) => setDraftValue("ftpHost", event.target.value)} placeholder="ftp.vendor.com" /></div>
            <div className="grid gap-2"><Label>FTP port</Label><Input type="number" value={draft.ftpPort || 21} onChange={(event) => setDraftValue("ftpPort", Number(event.target.value || 21))} /></div>
            <div className="grid gap-2"><Label>FTP username</Label><Input value={draft.ftpUsername || ""} onChange={(event) => setDraftValue("ftpUsername", event.target.value)} /></div>
            <div className="grid gap-2"><Label>FTP password {draft.ftpPasswordConfigured ? "(saved)" : ""}</Label><Input type="password" value={draft.ftpPassword || ""} onChange={(event) => setDraftValue("ftpPassword", event.target.value)} placeholder={draft.ftpPasswordConfigured ? "Leave blank to keep saved password" : "Enter password"} /></div>
            <div className="grid gap-2 md:col-span-2"><Label>Remote file path</Label><Input value={draft.ftpRemotePath || ""} onChange={(event) => setDraftValue("ftpRemotePath", event.target.value)} placeholder="/exports/products.bson.gz" /></div>
            <div className="grid gap-2"><Label>File format</Label><Select value={draft.fileFormat || "bson-gzip"} onValueChange={(value) => setDraft((current) => current ? { ...current, fileFormat: value, mappingProfile: value === "bson-gzip" ? "source-catalog-standard" : (mappingTemplates[0]?.id || "") } : current)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bson-gzip">BSON product datadump (.bson.gz)</SelectItem><SelectItem value="csv">CSV supplier feed</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">BSON uses the native Source Catalog import. CSV uses one of your saved import mappings.</p></div>
            <div className="grid min-w-0 gap-2"><Label>DataPlus mapping</Label>{draft.fileFormat === "csv" ? <Select value={draft.mappingProfile || "none"} onValueChange={(value) => setDraftValue("mappingProfile", value === "none" ? "" : value)}><SelectTrigger className="w-full min-w-0 [&>span]:truncate"><SelectValue placeholder="Select import mapping" /></SelectTrigger><SelectContent><SelectItem value="none">Select a mapping</SelectItem>{mappingTemplates.map((template) => <SelectItem key={template.id} value={template.id} className="max-w-[20rem] truncate" title={template.name}>{template.name}</SelectItem>)}</SelectContent></Select> : <Input className="min-w-0" value="Source catalog standard mapping" disabled />}</div>
            <div className="grid gap-2"><Label>Import target</Label><Input value="Source Catalog" disabled /></div>
            {!dataSource ? <div className="grid gap-2"><Label>Run mode</Label><Select value={draft.scheduleType || "times"} onValueChange={(value) => setDraftValue("scheduleType", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="times">Specific times</SelectItem><SelectItem value="interval">Every X hours</SelectItem></SelectContent></Select></div> : null}
            {dataSource && draft.fileFormat === "bson-gzip" ? <div className="grid gap-3 rounded-md border bg-muted/25 p-3 md:col-span-2"><div><Label>DataWarehouse jobs</Label><p className="text-xs text-muted-foreground">Run the comprehensive catalog import separately from frequent inventory and price checks.</p></div><div className="grid gap-3 md:grid-cols-2"><div className="grid gap-2 rounded-md border bg-background p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">Refresh</p><p className="text-xs text-muted-foreground">Existing SKUs only: price, cost, inventory, availability, and discontinuation.</p></div><Switch checked={draft.refreshEnabled ?? draft.enabled ?? false} onCheckedChange={(value) => setDraftValue("refreshEnabled", value)} /></div><Select value={draft.refreshScheduleType || draft.scheduleType || "times"} onValueChange={(value) => setDraftValue("refreshScheduleType", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="times">Specific times</SelectItem><SelectItem value="interval">Every X hours</SelectItem></SelectContent></Select>{(draft.refreshScheduleType || draft.scheduleType) === "interval" ? <Input type="number" min={1} max={24} value={draft.refreshScheduleEveryHours || draft.scheduleEveryHours || 24} onChange={(event) => setDraftValue("refreshScheduleEveryHours", Number(event.target.value || 24))} /> : <Input value={draft.refreshScheduleTimes || draft.scheduleTimes || "02:00"} onChange={(event) => setDraftValue("refreshScheduleTimes", event.target.value)} placeholder="02:00,14:00" />}</div><div className="grid gap-2 rounded-md border bg-background p-3"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">Full catalog import</p><p className="text-xs text-muted-foreground">New SKUs plus a complete source-record refresh. Keep it manual unless you want a controlled schedule.</p></div><Switch checked={Boolean(draft.fullImportEnabled)} onCheckedChange={(value) => setDraftValue("fullImportEnabled", value)} /></div><Select value={draft.fullImportScheduleType || "times"} onValueChange={(value) => setDraftValue("fullImportScheduleType", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="times">Specific times</SelectItem><SelectItem value="interval">Every X hours</SelectItem></SelectContent></Select>{draft.fullImportScheduleType === "interval" ? <Input type="number" min={1} max={24} value={draft.fullImportScheduleEveryHours || 24} onChange={(event) => setDraftValue("fullImportScheduleEveryHours", Number(event.target.value || 24))} /> : <Input value={draft.fullImportScheduleTimes || "01:00"} onChange={(event) => setDraftValue("fullImportScheduleTimes", event.target.value)} placeholder="01:00" />}</div></div></div> : draft.fileFormat === "bson-gzip" ? <div className="grid gap-2 md:col-span-2"><Label>Import behavior</Label><Select value={draft.syncMode || "split"} onValueChange={(value) => setDraftValue("syncMode", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="split">New SKUs plus changed price, inventory, and discontinuation</SelectItem><SelectItem value="catalog">New SKUs only</SelectItem><SelectItem value="reconciliation">Existing SKU price, inventory, and discontinuation only</SelectItem></SelectContent></Select></div> : null}
            <div className="grid gap-2"><Label>After import: Shopify inventory</Label><Select value={draft.postImportInventoryMode || "dry-run"} onValueChange={(value) => setDraftValue("postImportInventoryMode", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="disabled">Do not queue</SelectItem><SelectItem value="dry-run">Queue review dry run</SelectItem><SelectItem value="apply">Queue live update</SelectItem></SelectContent></Select></div>
            <div className="grid gap-2"><Label>After import: Shopify pricing</Label><Select value={draft.postImportPriceMode || "dry-run"} onValueChange={(value) => setDraftValue("postImportPriceMode", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="disabled">Do not queue</SelectItem><SelectItem value="dry-run">Queue review dry run</SelectItem><SelectItem value="apply">Queue live push</SelectItem></SelectContent></Select></div>
            {!dataSource ? <>{draft.scheduleType === "interval" ? <div className="grid gap-2"><Label>Every hours</Label><Input type="number" min={1} max={24} value={draft.scheduleEveryHours || 24} onChange={(event) => setDraftValue("scheduleEveryHours", Number(event.target.value || 24))} /></div> : <div className="grid gap-2"><Label>Times (24-hour, comma separated)</Label><Input value={draft.scheduleTimes || "02:00"} onChange={(event) => setDraftValue("scheduleTimes", event.target.value)} placeholder="02:00,14:00" /></div>}<div className="flex items-end gap-3"><Switch checked={Boolean(draft.enabled)} onCheckedChange={(value) => setDraftValue("enabled", value)} /><div><Label>Enable schedule</Label><p className="text-xs text-muted-foreground">Disabled feeds can still be run manually.</p></div></div></> : null}
            <div className="grid gap-2 md:col-span-2"><Label>Feed notes</Label><Textarea value={draft.notes || ""} onChange={(event) => setDraftValue("notes", event.target.value)} placeholder="Describe what this feed contains, update expectations, field assumptions, or operational follow-up." /></div>
          </div>}
          </ScrollArea>
          <DialogFooter className="shrink-0 border-t bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><Button variant="outline" onClick={() => void testConnection()} disabled={testing || !draft?.ftpHost || !draft?.ftpUsername || !(draft?.ftpPassword || draft?.ftpPasswordConfigured)}>{testing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Test connection</Button><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={() => void saveDraft()} disabled={saving}>{saving ? <><Loader2 className="size-4 animate-spin" /> Saving</> : "Save feed"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(notesFeed)} onOpenChange={(next) => { if (!next) setNotesFeed(null) }}>
        <DialogContent className="max-w-xl"><DialogHeader><DialogTitle>{notesFeed?.name || "Feed"} notes</DialogTitle><DialogDescription>Use this for the purpose of the feed, source assumptions, field mapping context, and operational instructions.</DialogDescription></DialogHeader><Textarea className="min-h-44" value={notesDraft} onChange={(event) => setNotesDraft(event.target.value)} placeholder="No notes yet." /><DialogFooter><Button variant="outline" onClick={() => setNotesFeed(null)}>Cancel</Button><Button onClick={() => void saveFeedNotes()} disabled={saving}>{saving ? "Saving..." : "Save notes"}</Button></DialogFooter></DialogContent>
      </Dialog>
    </Card>
  )
}

function channelLogStatusTone(entry: ChannelLogEntry): "success" | "destructive" | "warning" | "secondary" | "outline" {
  const status = String(entry.status || "").toLowerCase()
  if (entry.ok === false || ["failed", "error", "blocked"].includes(status)) return "destructive"
  if (["warning", "review", "stopped", "canceled"].includes(status)) return "warning"
  if (entry.ok === true || ["success", "completed", "done"].includes(status)) return "success"
  if (["queued", "running", "processing"].includes(status)) return "secondary"
  return "outline"
}

export function channelLogStatusLabel(entry: ChannelLogEntry) {
  if (entry.status) return String(entry.status).replace(/_/g, " ")
  if (entry.ok === true) return "success"
  if (entry.ok === false) return "failed"
  return "recorded"
}

export function ChannelLogsPanel({ channel = "" }: { channel?: string }) {
  const [logs, setLogs] = useState<ChannelLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selected, setSelected] = useState<ChannelLogEntry | null>(null)
  const [channelFilter, setChannelFilter] = useState(channel || "all")
  const [kind, setKind] = useState("all")
  const [actionGroup, setActionGroup] = useState("all")
  const [status, setStatus] = useState("all")
  const [query, setQuery] = useState("")

  const loadLogs = async () => {
    setLoading(true)
    setError("")
    try {
      const params = new URLSearchParams({ days: "365", limit: "1000" })
      const effectiveChannel = channel || (channelFilter === "all" ? "" : channelFilter)
      if (effectiveChannel) params.set("channel", effectiveChannel)
      if (kind !== "all") params.set("kind", kind)
      if (actionGroup !== "all") params.set("actionGroup", actionGroup)
      if (status !== "all") params.set("status", status)
      if (query.trim()) params.set("query", query.trim())
      const result = await api<{ logs?: ChannelLogEntry[] }>(`/api/channel-api-logs?${params.toString()}`)
      setLogs(result.logs || [])
    } catch (loadError) {
      setLogs([])
      setError(loadError instanceof Error ? loadError.message : "Unable to load channel activity.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadLogs() }, [channel, channelFilter, kind, actionGroup, status])

  const channels = useMemo(() => [...new Set([
    "Shopify",
    "eBay",
    "Temu",
    "TikTok Shop",
    "Whatnot",
    ...logs.map((entry) => String(entry.channel || "").trim()).filter(Boolean),
  ])].sort(), [logs])

  return (
    <Card>
      <CardHeader className="border-b py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{channel ? `${channel} activity` : "Channel activity"}</CardTitle>
            <CardDescription>Settings changes, jobs, syncs, webhooks, and API outcomes share one searchable history.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">1 year history</Badge>
            <Badge variant="outline">Files 7 days</Badge>
            <Button size="sm" variant="outline" onClick={() => void loadLogs()} disabled={loading}><RefreshCw className={cn("size-4", loading && "animate-spin")} /> Refresh</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="grid gap-2 border-b p-3 md:grid-cols-[minmax(14rem,1fr)_repeat(4,minmax(8rem,12rem))_auto]">
          <InputGroup>
            <InputGroupAddon><Search className="size-4" /></InputGroupAddon>
            <InputGroupInput value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadLogs() }} placeholder="Search activity, job, path, message" />
          </InputGroup>
          {!channel && <Select value={channelFilter} onValueChange={setChannelFilter}><SelectTrigger><SelectValue placeholder="All channels" /></SelectTrigger><SelectContent><SelectItem value="all">All channels</SelectItem>{channels.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select>}
          <Select value={kind} onValueChange={setKind}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All event types</SelectItem><SelectItem value="activity">Activity</SelectItem><SelectItem value="api">API request</SelectItem><SelectItem value="webhook">Webhook</SelectItem></SelectContent></Select>
          <Select value={actionGroup} onValueChange={setActionGroup}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All workflows</SelectItem>{["orders", "fulfillment", "inventory", "pricing", "products", "categories", "webhooks", "settings", "other"].map((value) => <SelectItem key={value} value={value}>{value.replace(/^./, (letter) => letter.toUpperCase())}</SelectItem>)}</SelectContent></Select>
          <Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="success">Success</SelectItem><SelectItem value="running">Running</SelectItem><SelectItem value="queued">Queued</SelectItem><SelectItem value="warning">Warning</SelectItem><SelectItem value="failed">Failed</SelectItem><SelectItem value="stopped">Stopped</SelectItem></SelectContent></Select>
          <Button size="sm" onClick={() => void loadLogs()} disabled={loading}>Apply</Button>
        </div>
        {error && <Alert variant="destructive" className="m-3"><AlertCircle className="size-4" /><AlertTitle>Channel history unavailable</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
        <ScrollArea className="h-[34rem]">
          <Table>
            <TableHeader><TableRow><TableHead>Time</TableHead>{!channel && <TableHead>Channel</TableHead>}<TableHead>Activity</TableHead><TableHead>Workflow</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Reference</TableHead></TableRow></TableHeader>
            <TableBody>
              {logs.map((entry) => <TableRow key={entry.id} className="cursor-pointer" onClick={() => setSelected(entry)}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dateLabel(entry.createdAt)}</TableCell>
                {!channel && <TableCell><Badge variant="outline">{entry.channel || "Channel"}</Badge></TableCell>}
                <TableCell className="max-w-[34rem]"><p className="truncate font-medium">{entry.operation || "Channel event"}</p><p className="truncate text-xs text-muted-foreground">{entry.message || entry.path || "No additional message"}</p></TableCell>
                <TableCell className="capitalize text-sm">{entry.actionGroup || "other"}</TableCell>
                <TableCell className="capitalize text-sm text-muted-foreground">{entry.kind || "api"}</TableCell>
                <TableCell><Badge variant={channelLogStatusTone(entry)} className="capitalize">{channelLogStatusLabel(entry)}</Badge></TableCell>
                <TableCell>{entry.jobId ? <Button asChild size="sm" variant="outline" onClick={(event) => event.stopPropagation()}><a href={`/jobs/${encodeURIComponent(entry.jobId)}`}>Open job</a></Button> : <span className="font-mono text-xs text-muted-foreground">{entry.requestId || entry.entityId || "-"}</span>}</TableCell>
              </TableRow>)}
              {!logs.length && !loading && <TableRow><TableCell colSpan={channel ? 6 : 7} className="h-32 text-center text-muted-foreground">No channel activity matches these filters.</TableCell></TableRow>}
              {loading && <TableRow><TableCell colSpan={channel ? 6 : 7} className="h-32 text-center"><Loader2 className="mx-auto size-5 animate-spin text-primary" /><p className="mt-2 text-sm text-muted-foreground">Loading channel activity...</p></TableCell></TableRow>}
            </TableBody>
          </Table>
        </ScrollArea>
        <div className="border-t px-4 py-3 text-xs text-muted-foreground">Showing the latest {numberLabel(logs.length)} matching events. Lightweight event metadata remains searchable for 365 days; large artifacts expire after 7 days.</div>
      </CardContent>
      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>{selected?.operation || "Channel activity detail"}</DialogTitle><DialogDescription>{selected?.channel || "Channel"} · {dateLabel(selected?.createdAt)}</DialogDescription></DialogHeader>
          {selected && <div className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label="Status" value={channelLogStatusLabel(selected)} /><Detail label="Workflow" value={selected.actionGroup || "other"} />
            <Detail label="Event type" value={selected.kind || "api"} /><Detail label="Trigger" value={selected.trigger || "system"} />
            <Detail label="Actor" value={selected.actor || "system"} /><Detail label="Phase" value={selected.phase || "-"} />
            <Detail label="HTTP" value={(selected.method || selected.statusCode) ? `${selected.method || ""} ${selected.statusCode || ""}`.trim() : "-"} /><Detail label="Duration" value={selected.durationMs ? `${numberLabel(selected.durationMs)} ms` : "-"} />
            <div className="sm:col-span-2"><Detail label="Message" value={selected.message || "No message recorded."} /></div>
            {selected.path && <div className="sm:col-span-2"><Detail label="Endpoint" value={selected.path} /></div>}
            <Detail label="Request ID" value={selected.requestId || "-"} /><Detail label="Entity" value={[selected.entityType, selected.entityId].filter(Boolean).join(" · ") || "-"} />
          </div>}
          <DialogFooter>{selected?.jobId && <Button asChild><a href={`/jobs/${encodeURIComponent(selected.jobId)}`}>Open job detail</a></Button>}<Button variant="outline" onClick={() => setSelected(null)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

export function CatalogChannelMarks({ item, channels }: { item: ProductItem; channels: ChannelConnection[] }) {
  const enabled = channels.filter((channel) => channel.connected && String(channel.status || "active").toLowerCase() !== "inactive")
  if (!enabled.length) return <span className="text-xs text-muted-foreground">No channels enabled</span>
  return <div className="flex min-w-28 items-center gap-1.5">
    {enabled.map((channel) => {
      const { isShopify, isEbay, state, ebayState } = catalogChannelState(item, channel)
      const destinationUrl = marketplaceListingUrl(item, channel)
      const listingUrl = state === "live" ? destinationUrl : ""
      const sourceUrl = item.productCatalogSku || item.sku ? `/products/${encodeURIComponent(item.productCatalogSku || item.sku || "")}` : ""
      const walmart = channel.name.toLowerCase().includes("walmart") ? ((item as ProductItem & Record<string, unknown>).walmartListing || {}) as Record<string, unknown> : null
      const stateLabel = walmart ? String(walmart.publishedStatus || "Not verified").replaceAll("_", " ") : state === "live"
        ? isEbay ? ebayState.label : "Live on the storefront"
        : state === "attention"
          ? isShopify
            ? "In Shopify catalog, not published to the storefront"
            : isEbay ? ebayState.label : "Needs attention"
          : "Not enabled for this SKU"
      const stateDetail = isEbay ? ebayState.detail : stateLabel
      const src = channel.logoDataUrl || channel.logoUrl
      const fallback = isShopify ? "S" : isEbay ? "e" : String(channel.name || "?").slice(0, 1).toUpperCase()
      const color = state === "live"
        ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
        : state === "attention"
          ? "border-amber-500/50 bg-amber-500/15 text-amber-800 dark:text-amber-200"
          : "border-muted-foreground/25 bg-muted/70 text-muted-foreground grayscale opacity-70"
      const icon = src ? <img src={src} alt="" data-no-image-preview className="size-full object-contain p-1" /> : <span className="text-xs font-bold">{fallback}</span>
      const className = `grid size-7 shrink-0 place-items-center overflow-hidden rounded-md border transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default ${color}`
      return (
        <Tooltip key={channel.id || channel.name}>
          <TooltipTrigger asChild>
            {listingUrl ? (
              <a href={listingUrl} target="_blank" rel="noreferrer" data-no-image-preview className={className} aria-label={`Open ${channel.name} listing for ${item.sku}`}>{icon}</a>
            ) : sourceUrl ? (
              <a href={sourceUrl} data-no-image-preview className={className} aria-label={`View source record for ${item.sku}`}>{icon}</a>
            ) : (
              <span data-no-image-preview className={className} aria-label={`${channel.name}: ${stateLabel}`}>{icon}</span>
            )}
          </TooltipTrigger>
          <TooltipContent className="w-64 p-3" data-no-image-preview>
            <p className="text-xs leading-5">{channel.name}: {stateLabel}.</p>
            {walmart && <div className="mt-1 space-y-1 text-xs"><p>Price: {typeof (walmart.price as { amount?: number })?.amount === "number" ? `${String((walmart.price as { currency?: string }).currency || "USD")} ${Number((walmart.price as { amount: number }).amount).toFixed(2)}` : "Not reported"}</p><p>Availability: {String(walmart.availability || "Not reported").replaceAll("_", " ")}</p><p>Fulfillment: {typeof walmart.fulfillmentLagTime === "number" && walmart.fulfillmentLagTime >= 0 ? `${walmart.fulfillmentLagTime} days` : "Not reported"}</p>{/^[1-9][0-9]*$/.test(String(walmart.itemId || "")) && <a className="block break-all underline" href={`https://www.walmart.com/ip/${walmart.itemId}`} target="_blank" rel="noopener noreferrer">Item ID: {String(walmart.itemId)}</a>}</div>}
            {isEbay && stateDetail !== stateLabel ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{stateDetail}</p> : null}
            {(destinationUrl || sourceUrl) && <div className="mt-2">
              <Button asChild type="button" size="sm" className="h-7 gap-1 px-2 text-[11px] text-white hover:text-white">
                <a href={destinationUrl || sourceUrl} target={destinationUrl ? "_blank" : undefined} rel={destinationUrl ? "noreferrer" : undefined} data-no-image-preview>
                  <ExternalLink className="size-3.5" />
                  {destinationUrl ? "View store" : "View source"}
                </a>
              </Button>
            </div>}
          </TooltipContent>
        </Tooltip>
      )
    })}
  </div>
}

function supplierCoverage(item: ProductItem) {
  const offers: NonNullable<ProductItem["vendorOffers"]> = [
    { supplier: item.supplier || item.vendor || "", vendorSku: item.vendorSku || item.sku || "", cost: item.cost, qty: item.qty ?? item.stockQty, primary: true },
    ...(item.vendorOffers || [])
  ].filter((offer) => offer.supplier || offer.vendorSku)
  const seen = new Set<string>()
  return offers.filter((offer) => {
    const key = `${String(offer.supplier || "").toLowerCase()}|${String(offer.vendorSku || "").toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function catalogCellText(value: unknown, max = 20) {
  const text = String(value || "").trim()
  if (!text) return "-"
  return text.length > max ? `${text.slice(0, Math.max(1, max - 3))}...` : text
}

export function catalogCategoryLeaf(value: unknown) {
  const path = String(value || "").trim()
  if (!path) return "Uncategorized"
  return path.split(/\s*(?:>|›)\s*/).filter(Boolean).at(-1) || path
}

export function CatalogSupplierCoverage({ item }: { item: ProductItem }) {
  const offers = supplierCoverage(item)
  if (!offers.length) return <span className="text-muted-foreground">Unassigned</span>
  const primary = offers[0]
  const additional = offers.length - 1
  return <HoverCard openDelay={180} closeDelay={120}>
    <HoverCardTrigger asChild>
      <button type="button" className="flex max-w-28 items-center gap-1.5 text-left text-sm hover:text-primary" aria-label={`View ${offers.length} supplier offer${offers.length === 1 ? "" : "s"}`} title={primary.supplier || "Unassigned"}>
        <span className="truncate">{catalogCellText(primary.supplier || "Unassigned", 15)}</span>
        {additional > 0 && <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">+{additional}</Badge>}
      </button>
    </HoverCardTrigger>
    <HoverCardContent align="start" className="w-80 p-3">
      <p className="mb-2 text-sm font-medium">Supplier coverage</p>
      <div className="grid gap-2">
        {offers.map((offer, index) => <div key={`${offer.supplier}-${offer.vendorSku}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-md border bg-muted/20 p-2 text-xs"><div className="min-w-0"><p className="truncate font-medium">{offer.supplier || "Unassigned"}{offer.primary ? " (primary)" : ""}</p><p className="truncate font-mono text-muted-foreground">{offer.vendorSku || "No vendor SKU"}</p></div><div className="text-right text-muted-foreground"><p>{moneyLabel(offer.cost)}</p><p>{numberLabel(offer.qty)} in stock</p></div></div>)}
      </div>
    </HoverCardContent>
  </HoverCard>
}

export function CatalogImage({ src, alt, className = "", imageClassName = "" }: { src?: string; alt: string; className?: string; imageClassName?: string }) {
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (!src || failed) return <div className={`grid place-items-center overflow-hidden rounded-md border bg-muted ${className}`} title={failed ? `${alt} image unavailable` : undefined}><Boxes className="size-4 text-muted-foreground" /></div>
  return <>
    <button type="button" data-catalog-image-viewer className={`group relative grid place-items-center overflow-hidden rounded-md border bg-muted transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className}`} title={`Enlarge ${alt}`} aria-label={`Enlarge ${alt}`} onClick={() => setOpen(true)}>
      <img src={src} alt={alt} className={`max-h-full max-w-full object-contain ${imageClassName}`} onError={() => setFailed(true)} />
      <span className="pointer-events-none absolute inset-0 grid place-items-center bg-background/60 text-xs font-medium opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">View image</span>
    </button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[92vh] max-w-[96vw] overflow-hidden p-3 sm:max-w-4xl">
        <DialogHeader className="sr-only"><DialogTitle>{alt}</DialogTitle></DialogHeader>
        <div className="grid max-h-[84vh] place-items-center overflow-auto rounded-md bg-muted/40 p-2">
          <img src={src} alt={alt} className="max-h-[80vh] max-w-full object-contain" />
        </div>
      </DialogContent>
    </Dialog>
  </>
}

export function CatalogImagePreviewLayer() {
  const [activeImage, setActiveImage] = useState<{ src: string; alt: string } | null>(null)
  useEffect(() => {
    const openPreview = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("img") : null
      if (!(target instanceof HTMLImageElement) || !target.currentSrc || !target.closest("main") || target.closest("[data-no-image-preview], [data-catalog-image-viewer]")) return
      event.preventDefault()
      event.stopPropagation()
      setActiveImage({ src: target.currentSrc, alt: target.alt || "Catalog image" })
    }
    document.addEventListener("click", openPreview, true)
    return () => document.removeEventListener("click", openPreview, true)
  }, [])
  return <Dialog open={Boolean(activeImage)} onOpenChange={(open) => !open && setActiveImage(null)}>
    <DialogContent className="max-h-[92vh] max-w-[96vw] overflow-hidden p-3 sm:max-w-4xl">
      <DialogHeader className="sr-only"><DialogTitle>{activeImage?.alt || "Catalog image"}</DialogTitle></DialogHeader>
      <div className="grid max-h-[84vh] place-items-center overflow-auto rounded-md bg-muted/40 p-2">
        {activeImage && <img src={activeImage.src} alt={activeImage.alt} className="max-h-[80vh] max-w-full object-contain" data-no-image-preview />}
      </div>
    </DialogContent>
  </Dialog>
}

export function OrderItemsProfitLoss({ lines, pnl }: { lines: Array<Record<string, unknown>>; pnl: Record<string, unknown> }) {
  const shippingCostLabel = String(pnl.shippingCostStatus || "estimated") === "reconciled" ? "Shipping expense (reconciled)" : "Shipping expense (estimated)"
  const channelFeeLabel = String(pnl.marketplaceFeeStatus || "estimated") === "reconciled" ? "Channel fees (reconciled)" : "Channel fees (estimated)"
  const itemRevenue = Number(pnl.itemRevenue || 0)
  const shippingCollected = Number(pnl.shippingCollected || 0)
  const totalRevenue = Number(pnl.orderTotal || itemRevenue + shippingCollected)
  const refunds = Number(pnl.refunds || 0)
  const netRevenue = totalRevenue - refunds
  const cogs = Number(pnl.estimatedCogs || 0)
  const grossProfit = netRevenue - cogs
  const shippingCost = Number(pnl.shippingLabelCost || 0)
  const channelFees = Number(pnl.marketplaceFees || 0)
  const dropshipFees = Number(pnl.dropshipFees || 0)
  const contributionProfit = Number(pnl.grossProfit || 0)
  const statementRow = (label: string, amount: number, options: { strong?: boolean; indent?: boolean; border?: boolean } = {}) => <TableRow className={options.border ? "border-t-2" : undefined}>
    <TableCell className={`${options.strong ? "font-semibold" : ""} ${options.indent ? "pl-8 text-muted-foreground" : ""}`}>{label}</TableCell>
    <TableCell className={`text-right tabular-nums ${options.strong ? "font-semibold" : ""} ${amount < 0 ? "text-destructive" : ""}`}>{amount < 0 ? `(${moneyLabel(Math.abs(amount))})` : moneyLabel(amount)}</TableCell>
  </TableRow>
  return <TabsContent value="items" className="grid gap-4 pt-4">
    <Card>
      <CardHeader><div className="flex flex-wrap items-end justify-between gap-3"><div><CardTitle className="text-base">Order income statement</CardTitle><CardDescription>Revenue and expenses are shown once, in accounting order. Reconciled amounts replace estimates when available.</CardDescription></div><div className="text-right"><p className="text-xs font-medium uppercase text-muted-foreground">Contribution margin</p><p className={`text-xl font-semibold tabular-nums ${contributionProfit < 0 ? "text-destructive" : ""}`}>{Number(pnl.grossMarginPercent || 0).toFixed(1)}%</p></div></div></CardHeader>
      <CardContent className="p-0"><div className="overflow-x-auto"><Table className="min-w-[520px]"><TableHeader><TableRow><TableHead>Account</TableHead><TableHead className="w-44 text-right">Amount</TableHead></TableRow></TableHeader><TableBody>
        {statementRow("Merchandise sales", itemRevenue, { indent: true })}
        {statementRow("Shipping income", shippingCollected, { indent: true })}
        {statementRow("Total revenue", totalRevenue, { strong: true, border: true })}
        {refunds ? statementRow("Less: refunds", -refunds, { indent: true }) : null}
        {statementRow("Net revenue", netRevenue, { strong: true })}
        {statementRow("Less: cost of goods sold", -cogs, { indent: true })}
        {statementRow("Gross profit", grossProfit, { strong: true, border: true })}
        {statementRow(`Less: ${channelFeeLabel.toLowerCase()}`, -channelFees, { indent: true })}
        {statementRow(`Less: ${shippingCostLabel.toLowerCase()}`, -shippingCost, { indent: true })}
        {dropshipFees ? statementRow("Less: dropship fees", -dropshipFees, { indent: true }) : null}
        {statementRow("Contribution profit", contributionProfit, { strong: true, border: true })}
      </TableBody></Table></div></CardContent>
    </Card>
    <Collapsible>
      <Card><CardHeader className="py-3"><CollapsibleTrigger asChild><Button variant="ghost" className="h-auto w-full justify-between px-0 text-left"><span><span className="block font-medium">COGS supporting detail</span><span className="block text-xs font-normal text-muted-foreground">Review the item quantities and costs behind the statement.</span></span><ChevronDown className="size-4" /></Button></CollapsibleTrigger></CardHeader><CollapsibleContent><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>Sell unit</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit price</TableHead><TableHead className="text-right">Unit cost</TableHead><TableHead className="text-right">Extended cost</TableHead></TableRow></TableHeader><TableBody>{lines.map((line, index) => {
              const local = (line.localProduct || {}) as Record<string, unknown>
              const variant = (line.variant || {}) as Record<string, unknown>
              const sku = String(line.sku || "-")
              const title = String(line.title || local.title || sku)
              const image = String(local.defaultImage || "")
              const quantity = Number(line.qty || 0)
              const unitCost = Number(line.unitCost || 0)
              return <TableRow key={`${sku}-${index}`}>
                <TableCell>
                  <div className="flex min-w-64 items-center gap-3">
                    {image ? <CatalogImage src={image} alt={title} className="size-12 shrink-0" imageClassName="p-1" /> : <div className="grid size-12 shrink-0 place-items-center rounded-md border bg-muted text-xs text-muted-foreground">--</div>}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1"><p className="font-mono font-medium">{local.sku ? <a className="hover:underline" href={`/products/${encodeURIComponent(String(local.sku))}`}>{sku}</a> : sku}</p>{local.sku ? null : <AlertCircle className="size-3.5 shrink-0 text-amber-700" aria-label="No local catalog match" />}</div>
                      <p className="max-w-64 truncate text-xs text-muted-foreground">{title}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>{variant.sku ? <><p>{String(variant.label || "Variant")}</p><p className="text-xs text-muted-foreground">Parent {String(variant.parentSku || local.sku || "-")}</p></> : <span>{Number(line.sellUnitQty || 1)} unit</span>}</TableCell>
                <TableCell className="text-right">{numberLabel(quantity)}</TableCell>
                <TableCell className="text-right">{moneyLabel(Number(line.price || 0))}</TableCell>
                <TableCell className="text-right">{moneyLabel(unitCost)}</TableCell>
                <TableCell className="text-right font-medium">{moneyLabel(quantity * unitCost)}</TableCell>
              </TableRow>
            })}</TableBody></Table></div></CardContent></CollapsibleContent></Card>
    </Collapsible>
  </TabsContent>
}

function lineShipmentFor(line: Record<string, unknown>, index: number, shipments: Array<Record<string, unknown>>) {
  const sku = String(line.sku || "").trim().toLowerCase()
  return shipments.find((shipment) => {
    const shipmentLines = Array.isArray(shipment.lines) ? shipment.lines as Array<Record<string, unknown>> : []
    return shipmentLines.some((shipmentLine) => {
      const lineIndexMatches = Number(shipmentLine.lineIndex ?? -1) === index
      const skuMatches = sku && String(shipmentLine.sku || "").trim().toLowerCase() === sku
      return lineIndexMatches || skuMatches
    })
  }) || shipments.find((shipment) => String(shipment.trackingNumber || "").trim() || String(shipment.carrierName || shipment.carrier || "").trim())
}

export function OrderFulfillmentItemRows({ lines, shipments, remaining, onEditTracking, onEditSku, vendorHrefForLine }: { lines: Array<Record<string, unknown>>; shipments: Array<Record<string, unknown>>; remaining: (line: Record<string, unknown>, index: number) => number; onEditTracking?: (shipment: Record<string, unknown>) => void; onEditSku?: (line: Record<string, unknown>, index: number) => void; vendorHrefForLine?: (line: Record<string, unknown>, index: number) => string }) {
  return <div className="overflow-x-auto rounded-md border"><Table className="min-w-[1040px] [&_th]:h-9 [&_th]:px-2 [&_td]:px-2 [&_td]:py-2"><TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Status</TableHead><TableHead>SKU</TableHead><TableHead>Supplier</TableHead><TableHead className="text-right">Qty</TableHead><TableHead className="text-right">Unit price</TableHead><TableHead className="text-right">Unit cost</TableHead><TableHead className="text-right">P&amp;L</TableHead><TableHead className="text-right">Remaining</TableHead></TableRow></TableHeader><TableBody>{lines.map((line, index) => {
    const local = (line.localProduct || {}) as Record<string, unknown>
    const variant = (line.variant || {}) as Record<string, unknown>
    const sku = String(line.sku || "-")
    const title = String(line.title || local.title || sku)
    const displayTitle = title.length > 30 ? `${title.slice(0, 30).trimEnd()}...` : title
    const image = String(local.defaultImage || "")
    const quantity = Number(line.qty || 0)
    const vendorName = String(line.vendor || local.supplier || "-")
    const vendorHref = vendorHrefForLine ? vendorHrefForLine(line, index) : ""
    const inventoryHref = sku && sku !== "-" ? `/inventory/${encodeURIComponent(sku)}` : ""
    const unfulfilled = remaining(line, index)
    const lineShipment = lineShipmentFor(line, index, shipments)
    const trackingNumber = lineShipment ? shipmentDisplayValue(lineShipment, "trackingNumber", "trackingNo", "trackingCode") : ""
    const carrierName = lineShipment ? shipmentDisplayValue(lineShipment, "carrierName", "carrier", "shippingCarrier", "shippingCompanyName") : ""
    const serviceName = lineShipment ? shipmentDisplayValue(lineShipment, "service", "shippingService", "shipLogisticsType") : ""
    const trackingUrl = lineShipment ? trackingUrlForShipment(lineShipment, carrierName, trackingNumber) : ""
    return <TableRow key={`${sku}-${index}`}>
      <TableCell className="min-w-72"><div className="flex min-w-0 items-start gap-2">{image ? <CatalogImage src={image} alt={title} className="size-10 shrink-0" imageClassName="p-1" /> : <div className="grid size-10 shrink-0 place-items-center rounded-md border bg-muted text-xs text-muted-foreground">--</div>}<div className="min-w-0"><p className="font-medium" title={title}>{displayTitle}</p>{variant.sku ? <p className="text-xs text-muted-foreground">{String(variant.label || "Variant")}</p> : null}{lineShipment ? <div className="mt-2 rounded-md border bg-muted/20 px-2 py-1.5 text-xs"><div className="flex flex-wrap items-start justify-between gap-2"><p className="font-medium">{carrierName || "Carrier not imported"}{serviceName ? <span className="font-normal text-muted-foreground"> / {serviceName}</span> : null}</p>{onEditTracking ? <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => onEditTracking(lineShipment)}><Pencil className="size-3" /> Edit</Button> : null}</div>{trackingNumber ? trackingUrl ? <a className="break-all font-mono text-primary hover:underline" href={trackingUrl} target="_blank" rel="noreferrer">Tracking {trackingNumber}</a> : <p className="break-all font-mono">Tracking {trackingNumber}</p> : <p className="text-muted-foreground">Label purchased; tracking pending</p>}</div> : null}</div></div></TableCell>
      <TableCell><Badge variant={unfulfilled > 0 ? "secondary" : "default"}>{unfulfilled > 0 ? "Unfulfilled" : "Fulfilled"}</Badge></TableCell>
      <TableCell className="font-mono text-xs"><div className="flex items-center gap-1">{local.sku ? <a className="text-foreground hover:underline" href={`/products/${encodeURIComponent(String(local.sku))}`}>{sku}</a> : <span className="inline-flex items-center gap-1">{sku}<AlertCircle className="size-3.5 text-amber-700" aria-label="No local catalog match" /></span>}{onEditSku ? <Button type="button" size="icon" variant="ghost" className="size-7 shrink-0" title={`Edit SKU ${sku}`} aria-label={`Edit SKU ${sku}`} onClick={() => onEditSku(line, index)}><Pencil className="size-3.5" /></Button> : null}</div>{line.originalSku && String(line.originalSku) !== sku ? <p className="mt-1 font-sans text-[11px] text-muted-foreground">Imported as {String(line.originalSku)}</p> : null}</TableCell>
      <TableCell>{vendorHref ? <a className="text-primary hover:underline" href={vendorHref}>{vendorName}</a> : vendorName}</TableCell>
      <TableCell className="text-right">{inventoryHref ? <a className="font-medium text-primary hover:underline" href={inventoryHref}>{numberLabel(quantity)}</a> : numberLabel(quantity)}</TableCell>
      <TableCell className="text-right font-medium">{moneyLabel(Number(line.price || 0))}</TableCell>
      <TableCell className="text-right">{moneyLabel(Number(line.unitCost || 0))}</TableCell>
      <TableCell className="text-right"><p className={Number(line.grossProfit || 0) < 0 ? "text-destructive" : "font-medium"}>{moneyLabel(Number(line.grossProfit || 0))}</p><p className="text-xs text-muted-foreground">{Number(line.grossMarginPercent || 0).toFixed(1)}%</p></TableCell>
      <TableCell className="text-right">{numberLabel(unfulfilled)}</TableCell>
    </TableRow>
  })}</TableBody></Table></div>
}

export function ActionTile({
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

function catalogImageUrlValue(image: unknown) {
  const value = typeof image === "object" && image !== null
    ? String((image as { url?: unknown; src?: unknown; href?: unknown }).url || (image as { src?: unknown }).src || (image as { href?: unknown }).href || "").trim()
    : String(image || "").trim()
  if (!value || value.startsWith("__dataplus_catalog_image__")) return ""
  if (value.startsWith("/api/")) return value
  try {
    const parsed = new URL(value)
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : ""
  } catch {
    return ""
  }
}

function catalogImageUrlList(images: unknown) {
  const rows = Array.isArray(images)
    ? images
    : String(images || "").split(/\r?\n/)
  return [...new Set(rows.map(catalogImageUrlValue).filter(Boolean))]
}

export function ProductDetailSheet({
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
  const [draft, setDraft] = useState<Record<string, string | number | boolean | string[]>>({})
  const [shopifyJob, setShopifyJob] = useState<ImportJob | null>(null)
  const [detailTab, setDetailTab] = useState("overview")

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
      shippingPackageOverride: item.shippingPackageOverride ?? item.packageDimensionsLocked === true,
      shipAlone: item.shipAlone === true,
      replenishableUseVendorRules: Boolean(item.replenishableUseVendorRules),
      replenishable: Boolean(item.replenishable),
      replenishableQtyUseVendorDefault: Boolean(item.replenishableQtyUseVendorDefault),
      replenishableQty: item.replenishableQty || 0,
      replenishableChannels: item.replenishableChannels || [],
      bypassSafetyQty: item.bypassSafetyQty === true,
    })
  }

  useEffect(() => {
    if (!open || !sourceItem?.sku) return
    let cancelled = false
    setLoading(true)
    setProduct(null)
    setEditing(false)
    setDetailTab("overview")
    api<{ item: ProductItem }>(`/api/inventory/${encodeURIComponent(sourceItem.sku)}`)
      .then((result) => {
        if (cancelled) return
        if (result.item.sourceOnly || result.item.inProducts === false) {
          setProduct(null)
          return
        }
        setProduct(result.item)
        initializeDraft(result.item)
      })
      .catch(() => {
        if (!cancelled) setProduct(null)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, sourceItem?.sku])

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

  const setDraftValue = (key: string, value: string | number | boolean | string[]) => setDraft((current) => ({ ...current, [key]: value }))
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
        <SheetHeader className="sticky top-0 z-20 border-b bg-background/95 pr-12 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="flex items-start gap-3">
            <div className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted">
              {sourceItem?.defaultImage ? <img src={sourceItem.defaultImage} alt="" className="max-h-full max-w-full object-contain" /> : <Boxes className="size-5 text-muted-foreground" />}
            </div>
            <div className="min-w-0">
              {standalone ? <><h2 className="truncate text-lg font-semibold">{sku || "Product"}</h2><p className="line-clamp-2 text-sm text-muted-foreground">{product?.title || sourceItem?.title || "Source catalog product"}</p></> : <><SheetTitle className="truncate">{sku || "Product"}</SheetTitle><SheetDescription className="line-clamp-2">{product?.title || sourceItem?.title || "Source catalog product"}</SheetDescription></>}
            </div>
            {!standalone && <Button size="sm" variant="outline" className="ml-auto shrink-0 max-sm:size-9 max-sm:px-0" onClick={openStandalone} title="Open full product page"><ExternalLink className="size-4" /><span className="max-sm:sr-only">Open page</span></Button>}
          </div>
        </SheetHeader>

        <div className={standalone ? "" : "min-h-0 flex-1 overflow-y-auto overscroll-contain"}>
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
                <Badge variant={product.active === false ? "outline" : "success"}>{product.active === false ? "Inactive" : "Active"}</Badge>
                <Badge variant={product.categoryVerified ? "success" : "warning"}>{product.categoryVerified ? "Category verified" : "Category needs review"}</Badge>
                {product.toBeDiscontinued && <Badge variant="destructive">Discontinued</Badge>}
              </div>
              <Button size="sm" variant={editing ? "outline" : "default"} onClick={() => { setEditing((current) => !current); if (!editing) initializeDraft(product) }}>
                <Pencil className="size-4" /> {editing ? "Cancel edit" : "Edit SKU"}
              </Button>
            </div>

            <Tabs value={detailTab} onValueChange={setDetailTab}>
              <TabsList className="h-auto w-full justify-start overflow-x-auto rounded-md p-1">
                <TabsTrigger className="shrink-0" value="overview">Overview</TabsTrigger>
                <TabsTrigger className="shrink-0" value="content">Content</TabsTrigger>
                <TabsTrigger className="shrink-0" value="identifiers">Identifiers</TabsTrigger>
                <TabsTrigger className="shrink-0" value="commerce">Commerce</TabsTrigger>
                <TabsTrigger className="shrink-0" value="shipping">Shipping</TabsTrigger>
                <TabsTrigger className="shrink-0" value="media">Media</TabsTrigger>
                <TabsTrigger className="shrink-0" value="replenishable">Replenishable</TabsTrigger>
                <TabsTrigger className="shrink-0" value="shopify">Shopify</TabsTrigger>
                <TabsTrigger className="shrink-0" value="suppliers">Suppliers</TabsTrigger>
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
                <MainCategoryPicker disabled={!editing} value={String(draft.mainCategory ?? "")} suggestedCategory={String(draft.vendorCategory || draft.sourceCategory || "")} onValueChange={(value) => setDraftValue("mainCategory", value)} />
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
                <Alert><Truck className="size-4" /><AlertTitle>{product.shippingMethod || "Needs measurements"}</AlertTitle><AlertDescription>{product.shippingClassReason || "Enter product measurements to classify shipping."}{product.dimensionalWeight ? ` Dimensional weight: ${numberLabel(product.dimensionalWeight)} lb.` : ""}</AlertDescription></Alert>
                <div className="grid gap-3"><div><p className="text-sm font-medium">Default shipping dimensions</p><p className="text-xs text-muted-foreground">The individual product measurements used for rates and labels.</p></div><MeasurementInputs prefix="item" draft={draft} disabled={!editing} onChange={setDraftValue} /></div>
                <div className="grid gap-3 rounded-md border p-3"><ToggleRow label="Use package override" description="Always use the package values below. When off, they remain the fallback if product measurements are missing." checked={Boolean(draft.shippingPackageOverride)} disabled={!editing} onCheckedChange={(checked) => setDraftValue("shippingPackageOverride", checked)} /><MeasurementInputs prefix="package" draft={draft} disabled={!editing} onChange={setDraftValue} /></div>
                <ToggleRow label="Ship alone" description="Create a separate package and label when this SKU is ordered with other products." checked={Boolean(draft.shipAlone)} disabled={!editing} onCheckedChange={(checked) => setDraftValue("shipAlone", checked)} />
              </TabsContent>

              <TabsContent value="media" className="grid gap-4 pt-3">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{(product.images || []).map((image, index) => { const src = typeof image === "string" ? image : image.url || image.src || ""; return src ? <a key={`${src}-${index}`} href={src} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-md border bg-muted"><img src={src} alt={`${product.sku} ${index + 1}`} className="size-full object-contain" /></a> : null })}</div>
                {!(product.images || []).length && <p className="rounded-md border p-4 text-sm text-muted-foreground">No product images are available.</p>}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Detail label="Image count" value={numberLabel(product.imageCount)} /><Detail label="Default image" value={product.defaultImage ? "Available" : "Missing"} /><Detail label="Supplier records" value={numberLabel(product.vendorOffers?.length || 1)} /><Detail label="Shadow SKUs" value={numberLabel(product.shadowSkuCount)} /></div>
              </TabsContent>

              <TabsContent value="replenishable" className="grid gap-4 pt-3">
                <ToggleRow label="Bypass safety quantity" description="No vendor or channel safety reserve for this SKU. Selling restrictions still apply." checked={draft.bypassSafetyQty === true} disabled={!editing} onCheckedChange={(checked) => setDraftValue("bypassSafetyQty", checked)} />
                <Alert><Warehouse className="size-4" /><AlertTitle>Sellable inventory override</AlertTitle><AlertDescription>{product.replenishableEffective ? "Marketplace channels use the configured replenishable target instead of current stock unless a safeguard suspends it. Each channel can supply its own fallback quantity." : "Normal warehouse stock is used for channel inventory."}</AlertDescription></Alert>
                <div className="grid gap-3 rounded-md border p-3">
                  <ToggleRow label="Use vendor replenishable rule" description="Vendor setting controls this SKU's enabled state and quantity." checked={usingVendorRules} disabled={!editing} onCheckedChange={(checked) => setDraftValue("replenishableUseVendorRules", checked)} />
                  <Separator />
                  <ToggleRow label="SKU replenishable" description="Publish a controlled quantity even when current stock is unavailable. Inactive and blocked SKUs still publish zero." checked={Boolean(draft.replenishable)} disabled={!editing || usingVendorRules} onCheckedChange={(checked) => setDraftValue("replenishable", checked)} />
                  <Separator />
                  <ToggleRow label="Use vendor default quantity" description="Use the replenishable quantity saved on the vendor profile." checked={usingVendorQty} disabled={!editing || usingVendorRules} onCheckedChange={(checked) => setDraftValue("replenishableQtyUseVendorDefault", checked)} />
                  <div className="grid gap-1.5"><Label>SKU replenishable quantity</Label><Input disabled={!editing || usingVendorRules || usingVendorQty} type="number" min="0" value={String(draft.replenishableQty ?? 0)} onChange={(event) => setDraftValue("replenishableQty", event.target.value)} /><p className="text-xs text-muted-foreground">Leave at 0 to use each channel's default replenishable quantity.</p></div>
                  <div className="grid gap-2"><Label>Apply to channels</Label><div className="grid gap-2 sm:grid-cols-2">{(product.channelInventoryPreview || []).map((row) => { const selectedChannels = Array.isArray(draft.replenishableChannels) ? draft.replenishableChannels : []; const selected = selectedChannels.length === 0 || selectedChannels.includes(row.channel); return <button key={row.channel} type="button" disabled={!editing} onClick={() => { const explicit = selectedChannels.length ? selectedChannels : (product.channelInventoryPreview || []).map((entry) => entry.channel); const next = selected ? explicit.filter((channel) => channel !== row.channel) : [...new Set([...explicit, row.channel])]; if (next.length) setDraftValue("replenishableChannels", next) }} className={cn("flex items-center gap-2 rounded-md border p-2 text-left text-sm", selected ? "border-primary bg-primary/10" : "bg-muted/20 text-muted-foreground")}><Checkbox tabIndex={-1} checked={selected} /><span>{row.channelName}</span></button> })}</div><p className="text-xs text-muted-foreground">At least one channel must remain selected. Existing records with no saved scope apply to every configured channel.</p></div>
                </div>
                <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Channel</TableHead><TableHead>Policy</TableHead><TableHead className="text-right">Physical</TableHead><TableHead className="text-right">Target</TableHead><TableHead className="text-right">Max</TableHead><TableHead className="text-right">Will send</TableHead><TableHead>Last observed</TableHead></TableRow></TableHeader><TableBody>{(product.channelInventoryPreview || []).map((row) => <TableRow key={`inventory-preview-${row.channel}`}><TableCell><div className="font-medium">{row.channelName}</div>{row.locationName || row.locationId ? <div className="max-w-40 truncate text-xs text-muted-foreground">{row.locationName || row.locationId}</div> : null}</TableCell><TableCell><Badge variant={row.suspended ? "destructive" : row.enabled ? "success" : "outline"}>{row.suspended ? "Suspended" : row.enabled ? `${row.source} target` : "Physical stock"}</Badge>{row.reason ? <p className="mt-1 max-w-52 text-xs text-destructive">{row.reason}</p> : null}</TableCell><TableCell className="text-right">{numberLabel(row.physicalAvailable)}</TableCell><TableCell className="text-right">{row.enabled ? numberLabel(row.targetQty) : "-"}</TableCell><TableCell className="text-right">{row.maxQty ? numberLabel(row.maxQty) : "None"}</TableCell><TableCell className={cn("text-right font-semibold", row.finalQty > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>{numberLabel(row.finalQty)}</TableCell><TableCell><div>{row.lastSentQty === null || row.lastSentQty === undefined ? "Not recorded" : numberLabel(row.lastSentQty)}</div>{row.lastSentAt ? <div className="text-xs text-muted-foreground">{dateLabel(row.lastSentAt)}</div> : null}</TableCell></TableRow>)}{!(product.channelInventoryPreview || []).length ? <TableRow><TableCell colSpan={7} className="h-20 text-center text-muted-foreground">No marketplace channels are configured.</TableCell></TableRow> : null}</TableBody></Table></div>
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

              <TabsContent value="suppliers" className="grid gap-4 pt-3"><ProductSupplierCoverage product={product} active={detailTab === "suppliers"} /></TabsContent>
            </Tabs>
          </div>
        )}
        </div>
        {product && editing && <SheetFooter className="sticky bottom-0 z-20 border-t bg-background/95 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur supports-[backdrop-filter]:bg-background/80"><Button onClick={save} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save SKU settings</Button></SheetFooter>}
    </>
  )

  if (standalone) return <div className="mx-auto max-w-7xl">{content}</div>
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent side="right" className="h-[100dvh] w-screen max-w-none overflow-hidden p-0 sm:w-full sm:max-w-5xl">{content}</SheetContent></Sheet>
}

type InventoryOperationOrder = { id?: string; orderNumber?: string; buyer?: string; source?: string; status?: string; createdAt?: string; shippedAt?: string; fulfilledAt?: string; inventoryQuantity?: number; inventoryFulfilledQty?: number; inventoryAllocatedQty?: number; inventoryUnallocatedQty?: number; inventoryMatchMethod?: string; inventoryMatchedSku?: string; inventoryAllocations?: Array<{ id?: string; warehouseName?: string; warehouseId?: string; qty?: number; status?: string; assignedAt?: string }> }
type InventoryStockSource = { id?: string; sourceType?: "physical" | "supplier" | "marketplace"; sourceName?: string; location?: string; sourceSku?: string; onHand?: number; reserved?: number; available?: number; cost?: number; updatedAt?: string; countsTowardOnHand?: boolean }
type InventoryLedgerEntry = { id?: string; createdAt?: string; type?: string; source?: string; referenceNumber?: string; referenceId?: string; user?: string; warehouseName?: string; quantityChange?: number; reservedChange?: number; qtyBefore?: number | string; qtyAfter?: number | string; reservedBefore?: number; reservedAfter?: number; reason?: string }
type InventoryPurchaseOrder = { id?: string; poNumber?: string; supplier?: string; status?: string; warehouseId?: string; warehouseName?: string; orderedQty?: number; receivedQty?: number; openQty?: number; unitCost?: number; expectedAt?: string; placedAt?: string; updatedAt?: string; orderNumbers?: string[] }
type InventoryReturn = { id?: string; returnNumber?: string; orderId?: string; orderNumber?: string; source?: string; status?: string; condition?: string; disposition?: string; reason?: string; qty?: number; warehouseName?: string; createdAt?: string; receivedAt?: string; restockedAt?: string; updatedAt?: string }

export function rmaHref(record: Record<string, unknown>) {
  const slug = String(record.returnSlug || record.returnNumber || record.id || "").trim().toLowerCase()
  return `/returns/${encodeURIComponent(slug)}`
}
type InventoryHealthSignal = { id?: string; severity?: "success" | "warning" | "critical"; title?: string; detail?: string; tab?: string }
type InventoryChannelAvailability = { channelId?: string; channelName?: string; enabled?: boolean; sellableQty?: number; mappings?: Array<ShopifyWarehouseMapping & { onHand?: number; reserved?: number; available?: number; sellable?: number; healthy?: boolean; issues?: string[] }> }
type InventoryOperationData = { item?: ProductItem; warehouses?: Array<{ id?: string; name?: string; code?: string; requireBinValidation?: boolean; bins?: Array<{ id?: string; code?: string; name?: string; active?: boolean; isDefault?: boolean }> }>; orders?: InventoryOperationOrder[]; allocations?: Array<{ id?: string; orderId?: string; orderNumber?: string; buyer?: string; warehouseName?: string; warehouseId?: string; qty?: number; status?: string; assignedAt?: string; updatedAt?: string }>; stockSources?: InventoryStockSource[]; ledger?: InventoryLedgerEntry[]; purchaseOrders?: InventoryPurchaseOrder[]; returns?: InventoryReturn[]; health?: InventoryHealthSignal[]; channelAvailability?: InventoryChannelAvailability[]; metrics?: { openOrderCount?: number; openOrderUnits?: number; allocatedUnits?: number; unallocatedUnits?: number; recordedOnHand?: number; physicalOnHand?: number; physicalAvailable?: number; supplierAvailable?: number; stockBasis?: string; shopifyQuantity?: number; ebayQuantity?: number; shippedOrderCount?: number; shipped30?: number; shipped90?: number; averageDaily30?: number; averageDaily90?: number; daysOfCover?: number | null; available?: number; incomingUnits?: number; openPurchaseOrderCount?: number; openReturnCount?: number; returned30?: number; returned90?: number; returnRate90?: number; sellThrough30?: number; projectedAvailable?: number; staleAllocationCount?: number; lastMovementAt?: string } }
type ReceiptAllocationPreview = { availableQty?: number; candidateCount?: number; proposedOrderCount?: number; proposedQty?: number; remainingQty?: number; poAdjustmentQty?: number; candidates?: Array<{ orderId?: string; orderNumber?: string; buyer?: string; orderDate?: string; shipBy?: string; title?: string; proposedQty?: number; requiresPoAdjustment?: boolean; purchaseOrderNumbers?: string[] }> }
type InventoryAdjustmentPreview = { sku?: string; warehouseId?: string; warehouseName?: string; qtyBefore?: number; qtyAfter?: number; quantityChange?: number; reservedBefore?: number; reservedAfter?: number; reason?: string; reasonLabel?: string; affectedOrders?: Array<{ orderId?: string; orderNumber?: string; buyer?: string; allocatedQty?: number; releaseQty?: number }> }

const inventoryAdjustmentReasonOptions = [
  { value: "received_by_mistake", label: "Received by mistake" },
  { value: "not_found_in_warehouse", label: "Cannot find in warehouse" },
  { value: "testing", label: "Testing" },
  { value: "damaged", label: "Damaged or unsellable" },
  { value: "expired", label: "Expired" },
  { value: "theft_or_loss", label: "Theft or loss" },
  { value: "count_correction", label: "Physical count correction" },
  { value: "return_correction", label: "Return correction" },
  { value: "transfer_correction", label: "Transfer correction" },
  { value: "other", label: "Other" },
] as const

function InventoryChannelAvailabilityTable({ rows }: { rows: InventoryChannelAvailability[] }) {
  const mappings = rows.flatMap((channel) => (channel.mappings || []).map((mapping) => ({ channel, mapping })))
  return <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Channel</TableHead><TableHead>Source warehouse</TableHead><TableHead>Channel location</TableHead><TableHead>On hand</TableHead><TableHead>Reserved</TableHead><TableHead>Available</TableHead><TableHead>Publish qty</TableHead><TableHead>Health</TableHead></TableRow></TableHeader><TableBody>{mappings.map(({ channel, mapping }) => <TableRow key={`${channel.channelId}:${mapping.id}`}><TableCell><div className="flex items-center gap-2"><span className="font-medium">{channel.channelName || "Channel"}</span>{channel.enabled === false && <Badge variant="secondary">Disabled</Badge>}</div></TableCell><TableCell>{mapping.sourceWarehouseName || mapping.sourceWarehouseId || "-"}</TableCell><TableCell><p>{mapping.destinationLocationName || mapping.externalWarehouseCode || "Unmapped"}</p><p className="max-w-48 truncate font-mono text-xs text-muted-foreground">{mapping.destinationLocationId || "No destination ID"}</p></TableCell><TableCell>{numberLabel(mapping.onHand)}</TableCell><TableCell>{numberLabel(mapping.reserved)}</TableCell><TableCell>{numberLabel(mapping.available)}</TableCell><TableCell className="font-semibold">{numberLabel(mapping.sellable)}</TableCell><TableCell><Badge variant={mapping.healthy ? "outline" : "destructive"} className={mapping.healthy ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : ""} title={(mapping.issues || []).join("; ")}>{mapping.healthy ? "Ready" : `${(mapping.issues || []).length || 1} issue`}</Badge></TableCell></TableRow>)}{!mappings.length && <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">No enabled channel warehouse mappings are configured for this SKU.</TableCell></TableRow>}</TableBody></Table></div>
}

function InventorySourceAwareSummary({ data }: { data: InventoryOperationData }) {
  const metrics = data.metrics || {}
  const sources = data.stockSources || []
  const openOrders = (data.orders || []).filter((order) => Number(order.inventoryQuantity || 0) > Number(order.inventoryFulfilledQty || 0))
  const sourceTone = (type?: string) => type === "physical" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : type === "supplier" ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300"
  return <div className="grid gap-4">
    {metrics.stockBasis === "legacy-blended" && <Alert className="border-amber-500/40 bg-amber-500/10"><AlertCircle className="size-4 text-amber-700 dark:text-amber-300" /><AlertTitle>Recorded stock is not tied to a physical warehouse</AlertTitle><AlertDescription>The sellable quantity may originate from supplier feeds. It is shown separately and is not treated as Staten Island or other physical stock until a warehouse receipt or audit creates a warehouse balance.</AlertDescription></Alert>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <Detail label="Physical on hand" value={numberLabel(metrics.physicalOnHand)} />
      <Detail label="Physical available" value={numberLabel(metrics.physicalAvailable)} />
      <Detail label="Supplier availability" value={numberLabel(metrics.supplierAvailable)} />
      <Detail label="Open demand" value={numberLabel(metrics.openOrderUnits)} />
      <Detail label="Allocated" value={numberLabel(metrics.allocatedUnits)} />
      <Detail label="Needs allocation" value={numberLabel(metrics.unallocatedUnits)} />
    </div>
    <Card><CardHeader><CardTitle className="text-sm">Inventory by source</CardTitle><CardDescription>Physical balances count toward warehouse stock. Supplier and marketplace quantities are reference snapshots and are never added to physical on hand.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Source</TableHead><TableHead>Type</TableHead><TableHead>SKU / bin</TableHead><TableHead>On hand</TableHead><TableHead>Reserved</TableHead><TableHead>Available</TableHead><TableHead>Cost</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>{sources.map((source) => <TableRow key={source.id}><TableCell className="font-medium">{source.sourceName || "Unknown"}</TableCell><TableCell><Badge variant="outline" className={sourceTone(source.sourceType)}>{source.sourceType === "physical" ? "Physical stock" : source.sourceType === "supplier" ? "Supplier feed" : "Channel snapshot"}</Badge></TableCell><TableCell>{source.location || source.sourceSku || "-"}</TableCell><TableCell>{source.sourceType === "physical" ? numberLabel(source.onHand) : "-"}</TableCell><TableCell>{source.sourceType === "physical" ? numberLabel(source.reserved) : "-"}</TableCell><TableCell>{numberLabel(source.available)}</TableCell><TableCell>{source.sourceType === "supplier" ? moneyLabel(source.cost) : "-"}</TableCell><TableCell>{dateLabel(source.updatedAt)}</TableCell></TableRow>)}{!sources.length && <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">No warehouse, supplier, or marketplace inventory sources are recorded.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-sm">Order demand and allocation</CardTitle><CardDescription>Shows the ordered channel SKU, its catalog match, and whether physical stock has been reserved.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Channel / customer</TableHead><TableHead>Matched SKU</TableHead><TableHead>Required</TableHead><TableHead>Allocated</TableHead><TableHead>Unallocated</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{openOrders.map((order) => <TableRow key={order.id}><TableCell className="font-medium"><a className="text-primary hover:underline" href={`/orders/${encodeURIComponent(order.id || "")}`}>{order.orderNumber || order.id}</a></TableCell><TableCell><p>{order.source || "-"}</p><p className="text-xs text-muted-foreground">{order.buyer || "Customer"}</p></TableCell><TableCell><p>{order.inventoryMatchedSku || data.item?.sku || "-"}</p><p className="text-xs text-muted-foreground">{order.inventoryMatchMethod || "Exact catalog SKU"}</p></TableCell><TableCell>{numberLabel(Number(order.inventoryQuantity || 0) - Number(order.inventoryFulfilledQty || 0))}</TableCell><TableCell>{numberLabel(order.inventoryAllocatedQty)}</TableCell><TableCell><Badge variant={Number(order.inventoryUnallocatedQty || 0) > 0 ? "destructive" : "outline"}>{numberLabel(order.inventoryUnallocatedQty)}</Badge></TableCell><TableCell>{order.status || "Open"}</TableCell></TableRow>)}{!openOrders.length && <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No open order demand references this SKU.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
  </div>
}

function InventorySkuDetailPageLegacy() {
  const sku = decodeURIComponent(window.location.pathname.replace(/^\/inventory\//, "").split("/")[0] || "")
  const [data, setData] = useState<InventoryOperationData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [tab, setTab] = useState("overview")
  const [allocateOpen, setAllocateOpen] = useState(false)
  const [orderId, setOrderId] = useState("")
  const [warehouseId, setWarehouseId] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [saving, setSaving] = useState(false)
  const item = data.item
  const metrics = data.metrics || {}
  const load = async () => { setLoading(true); try { setData(await api<InventoryOperationData>(`/api/inventory/${encodeURIComponent(sku)}/operations`)); setError("") } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load SKU inventory.") } finally { setLoading(false) } }
  useEffect(() => { if (sku) void load(); else { setError("The inventory URL is missing a SKU."); setLoading(false) } }, [sku])
  const openAllocation = () => { const order = (data.orders || []).find((row) => !["fulfilled", "shipped", "canceled", "cancelled", "void", "deleted"].includes(String(row.status || "").toLowerCase()) && Number(row.inventoryUnallocatedQty || 0) > 0); setOrderId(order?.id || ""); setWarehouseId(data.warehouses?.[0]?.id || ""); setQuantity(String(order?.inventoryUnallocatedQty || 1)); setAllocateOpen(true) }
  const allocate = async () => { setSaving(true); try { await api(`/api/inventory/${encodeURIComponent(sku)}/allocations`, { method: "POST", body: JSON.stringify({ orderId, warehouseId, qty: Number(quantity) }) }); toast.success("Stock allocated to the order."); setAllocateOpen(false); await load() } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Unable to allocate stock.") } finally { setSaving(false) } }
  const release = async (allocationId: string) => { setSaving(true); try { await api(`/api/inventory/${encodeURIComponent(sku)}/allocations/${encodeURIComponent(allocationId)}`, { method: "DELETE" }); toast.success("Allocation released."); await load() } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Unable to release allocation.") } finally { setSaving(false) } }
  if (loading) return <div className="grid gap-4"><Skeleton className="h-10 w-44" /><Skeleton className="h-36" /><Skeleton className="h-96" /></div>
  if (error || !item) return <div className="grid gap-4"><Button variant="outline" className="w-fit" asChild><a href="/inventory">Back to Inventory</a></Button><Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Inventory record unavailable</AlertTitle><AlertDescription>{error || "This SKU was not found."}</AlertDescription></Alert></div>
  const available = Number(metrics.physicalAvailable ?? 0)
  return <div className="grid gap-5"><div className="flex flex-wrap items-center justify-between gap-3"><Button variant="outline" asChild><a href="/inventory">Back to Inventory</a></Button><div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="size-4" /> Refresh</Button><Button size="sm" onClick={openAllocation}>Assign stock to order</Button></div></div><Card><CardContent className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto]"><div><p className="text-xs font-semibold uppercase text-muted-foreground">SKU inventory record</p><h1 className="mt-1 text-2xl font-semibold">{item.sku}</h1><p className="mt-1 text-sm text-muted-foreground">{item.marketplaceTitle || item.title || "Untitled product"}</p><div className="mt-3 flex flex-wrap gap-2"><Badge variant={available > 0 ? "default" : "destructive"}>{numberLabel(available)} physical available</Badge><Badge variant="outline">{numberLabel(metrics.recordedOnHand ?? item.qty)} recorded sellable</Badge><Badge variant="outline">{numberLabel(item.reserved)} reserved</Badge><Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">{numberLabel(metrics.supplierAvailable)} supplier feed</Badge>{(item.replenishableEffective ?? item.replenishable) && <Badge variant="secondary">Replenishable</Badge>}</div></div><div className="grid grid-cols-2 gap-2 text-sm"><Detail label="Supplier" value={item.supplier || item.vendor || "-"} /><Detail label="Reorder point" value={numberLabel(item.reorderPoint)} /></div></CardContent></Card><Tabs value={tab} onValueChange={setTab}><div className="overflow-x-auto rounded-md border bg-card p-1"><TabsList className="h-auto min-w-max justify-start bg-transparent p-0"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="allocations">Allocations ({(data.allocations || []).length})</TabsTrigger><TabsTrigger value="orders">Orders ({(data.orders || []).length})</TabsTrigger><TabsTrigger value="movement">Movement</TabsTrigger></TabsList></div><TabsContent value="overview" className="mt-4 grid gap-4"><InventorySourceAwareSummary data={data} /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Detail label="Open orders" value={`${numberLabel(metrics.openOrderCount)} / ${numberLabel(metrics.openOrderUnits)} units`} /><Detail label="Allocated" value={numberLabel(metrics.allocatedUnits)} /><Detail label="Shipped, 30 days" value={numberLabel(metrics.shipped30)} /><Detail label="Shipped, 90 days" value={numberLabel(metrics.shipped90)} /><Detail label="30-day daily velocity" value={Number(metrics.averageDaily30 || 0).toFixed(2)} /><Detail label="90-day daily velocity" value={Number(metrics.averageDaily90 || 0).toFixed(2)} /><Detail label="Days of cover" value={metrics.daysOfCover === null || metrics.daysOfCover === undefined ? "No sales signal" : `${Number(metrics.daysOfCover).toFixed(1)} days`} /><Detail label="Fulfilled orders" value={numberLabel(metrics.shippedOrderCount)} /></div><Card><CardHeader><CardTitle className="text-sm">Warehouse availability</CardTitle><CardDescription>Available-to-promise is on hand less committed reservations at each location.</CardDescription></CardHeader><CardContent><ProductWarehouseTable rows={item.warehouseStock || []} /></CardContent></Card></TabsContent><TabsContent value="allocations" className="mt-4"><Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="text-sm">Order allocations</CardTitle><CardDescription>Reservations protect available stock from being assigned to another order.</CardDescription></div><Button size="sm" onClick={openAllocation}>Assign stock</Button></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Customer</TableHead><TableHead>Warehouse</TableHead><TableHead>Quantity</TableHead><TableHead>Assigned</TableHead><TableHead /></TableRow></TableHeader><TableBody>{(data.allocations || []).map((allocation) => <TableRow key={allocation.id}><TableCell className="font-medium">{allocation.orderNumber || allocation.orderId}</TableCell><TableCell>{allocation.buyer || "-"}</TableCell><TableCell>{allocation.warehouseName || "-"}</TableCell><TableCell>{numberLabel(allocation.qty)}</TableCell><TableCell>{dateLabel(allocation.assignedAt)}</TableCell><TableCell><Button size="sm" variant="outline" disabled={saving} onClick={() => allocation.id && void release(allocation.id)}>Unassign</Button></TableCell></TableRow>)}{!(data.allocations || []).length && <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No active order allocations for this SKU.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card></TabsContent><TabsContent value="orders" className="mt-4"><Card><CardHeader><CardTitle className="text-sm">Orders using this SKU</CardTitle><CardDescription>Open, fulfilled, and shipped order lines feed the movement metrics above.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Customer</TableHead><TableHead>Channel</TableHead><TableHead>Status</TableHead><TableHead>Ordered</TableHead><TableHead>Fulfilled</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>{(data.orders || []).map((order) => <TableRow key={order.id}><TableCell className="font-medium">{order.orderNumber || order.id}</TableCell><TableCell>{order.buyer || "-"}</TableCell><TableCell>{order.source || "-"}</TableCell><TableCell><Badge variant={String(order.status || "").toLowerCase().includes("fulfill") ? "default" : "outline"}>{order.status || "Open"}</Badge></TableCell><TableCell>{numberLabel(order.inventoryQuantity)}</TableCell><TableCell>{numberLabel(order.inventoryFulfilledQty)}</TableCell><TableCell>{dateLabel(order.fulfilledAt || order.shippedAt || order.createdAt)}</TableCell></TableRow>)}{!(data.orders || []).length && <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No orders currently reference this SKU.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card></TabsContent><TabsContent value="movement" className="mt-4"><Card><CardHeader><CardTitle className="text-sm">Inventory movement</CardTitle><CardDescription>Every receipt, transfer, allocation, release, adjustment, and fulfillment recorded for this SKU.</CardDescription></CardHeader><CardContent><ProductInventoryLedgerRows rows={data.ledger || []} /></CardContent></Card></TabsContent></Tabs><Dialog open={allocateOpen} onOpenChange={setAllocateOpen}><DialogContent><DialogHeader><DialogTitle>Assign stock to order</DialogTitle><DialogDescription>Reserve inventory for an open order. This reduces available quantity but does not reduce on-hand stock.</DialogDescription></DialogHeader><div className="grid gap-4"><div className="grid gap-1"><Label>Order</Label><Select value={orderId} onValueChange={setOrderId}><SelectTrigger><SelectValue placeholder="Choose an order" /></SelectTrigger><SelectContent>{(data.orders || []).filter((order) => !["fulfilled", "shipped", "canceled", "cancelled", "void", "deleted"].includes(String(order.status || "").toLowerCase())).map((order) => <SelectItem key={order.id} value={order.id || ""}>{order.orderNumber || order.id} - {order.buyer || "Customer"}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1"><Label>Warehouse</Label><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger><SelectValue placeholder="Choose a warehouse" /></SelectTrigger><SelectContent>{(data.warehouses || []).map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id || ""}>{warehouse.name || warehouse.id}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1"><Label>Quantity</Label><Input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div></div><DialogFooter><Button variant="outline" onClick={() => setAllocateOpen(false)}>Cancel</Button><Button disabled={saving || !orderId || !warehouseId || Number(quantity) <= 0} onClick={() => void allocate()}>{saving && <Loader2 className="size-4 animate-spin" />} Assign stock</Button></DialogFooter></DialogContent></Dialog></div>
}

function InventorySkuDetailWorkspace() {
  const sku = decodeURIComponent(window.location.pathname.replace(/^\/inventory\//, "").split("/")[0] || "")
  const [data, setData] = useState<InventoryOperationData>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [tab, setTab] = useState("overview")
  const [allocateOpen, setAllocateOpen] = useState(false)
  const [reassignOpen, setReassignOpen] = useState(false)
  const [activeAllocation, setActiveAllocation] = useState<NonNullable<InventoryOperationData["allocations"]>[number] | undefined>(undefined)
  const [orderId, setOrderId] = useState("")
  const [warehouseId, setWarehouseId] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [note, setNote] = useState("")
  const [receiveOpen, setReceiveOpen] = useState(false)
  const [receiveWarehouseId, setReceiveWarehouseId] = useState("")
  const [receiveQuantity, setReceiveQuantity] = useState("1")
  const [receiveBin, setReceiveBin] = useState("")
  const [receiveNote, setReceiveNote] = useState("")
  const [receivedAllocation, setReceivedAllocation] = useState<{ receiptId: string; receiptNumber: string; preview: ReceiptAllocationPreview } | null>(null)
  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustWarehouseId, setAdjustWarehouseId] = useState("")
  const [adjustQuantity, setAdjustQuantity] = useState("0")
  const [adjustReason, setAdjustReason] = useState("")
  const [adjustNote, setAdjustNote] = useState("")
  const [adjustPreview, setAdjustPreview] = useState<InventoryAdjustmentPreview | null>(null)
  const [adjustPreviewLoading, setAdjustPreviewLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const item = data.item
  const metrics = data.metrics || {}
  const terminal = ["fulfilled", "shipped", "canceled", "cancelled", "void", "deleted", "refunded"]
  const eligibleOrders = (data.orders || []).filter((order) => !terminal.includes(String(order.status || "").toLowerCase()) && Number(order.inventoryUnallocatedQty || 0) > 0)
  const load = async () => {
    setLoading(true)
    try {
      const [operations, channelResult] = await Promise.all([
        api<InventoryOperationData>(`/api/inventory/${encodeURIComponent(sku)}/operations`),
        api<{ availability?: InventoryChannelAvailability[] }>(`/api/inventory/${encodeURIComponent(sku)}/channel-availability`).catch(() => ({ availability: [] })),
      ])
      setData({ ...operations, channelAvailability: channelResult.availability || [] })
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load SKU inventory.")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { if (sku) void load(); else { setError("The inventory URL is missing a SKU."); setLoading(false) } }, [sku])
  const openAllocation = () => {
    const order = eligibleOrders[0]
    setOrderId(order?.id || "")
    setWarehouseId(data.warehouses?.[0]?.id || "")
    setQuantity(String(order?.inventoryUnallocatedQty || 1))
    setNote("")
    setAllocateOpen(true)
  }
  const openReassign = (allocation: NonNullable<InventoryOperationData["allocations"]>[number]) => {
    const target = eligibleOrders.find((order) => order.id !== allocation.orderId)
    setActiveAllocation(allocation)
    setOrderId(target?.id || "")
    setWarehouseId(allocation.warehouseId || data.warehouses?.[0]?.id || "")
    setQuantity(String(allocation.qty || 1))
    setNote("")
    setReassignOpen(true)
  }
  const allocate = async () => {
    setSaving(true)
    try {
      await api(`/api/inventory/${encodeURIComponent(sku)}/allocations`, { method: "POST", body: JSON.stringify({ orderId, warehouseId, qty: Number(quantity), note }) })
      toast.success("Stock allocated to the order.")
      setAllocateOpen(false)
      await load()
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Unable to allocate stock.") } finally { setSaving(false) }
  }
  const reassign = async () => {
    if (!activeAllocation?.id) return
    setSaving(true)
    try {
      await api(`/api/inventory/${encodeURIComponent(sku)}/allocations/${encodeURIComponent(activeAllocation.id)}/reassign`, { method: "POST", body: JSON.stringify({ targetOrderId: orderId, warehouseId, qty: Number(quantity), note }) })
      toast.success("Allocation reassigned to the selected order.")
      setReassignOpen(false)
      await load()
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Unable to reassign stock.") } finally { setSaving(false) }
  }
  const release = async (allocationId: string) => {
    setSaving(true)
    try {
      await api(`/api/inventory/${encodeURIComponent(sku)}/allocations/${encodeURIComponent(allocationId)}`, { method: "DELETE" })
      toast.success("Allocation released.")
      await load()
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Unable to release allocation.") } finally { setSaving(false) }
  }
  const openReceive = () => {
    setReceiveWarehouseId(data.warehouses?.[0]?.id || "")
    setReceiveQuantity("1")
    setReceiveBin("")
    setReceiveNote("")
    setReceiveOpen(true)
  }
  const receiveInventory = async () => {
    if (!item) return
    setSaving(true)
    try {
      const result = await api<{ message?: string; receipt?: { id?: string; receiptNumber?: string }; allocationPreview?: ReceiptAllocationPreview }>("/api/warehouse-receipts", {
        method: "POST",
        body: JSON.stringify({ lookup: item.sku || sku, quantity: Number(receiveQuantity), warehouseId: receiveWarehouseId, locationBin: receiveBin, note: receiveNote, user: "Luis" }),
      })
      toast.success(result.message || "Physical inventory received.")
      setReceiveOpen(false)
      if (result.receipt?.id) setReceivedAllocation({ receiptId: result.receipt.id, receiptNumber: result.receipt.receiptNumber || "Receipt", preview: result.allocationPreview || {} })
      await load()
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Unable to receive physical inventory.") } finally { setSaving(false) }
  }
  const allocateReceivedInventory = async () => {
    if (!receivedAllocation) return
    setSaving(true)
    try {
      const result = await api<{ message?: string }>(`/api/warehouse-receipts/${encodeURIComponent(receivedAllocation.receiptId)}/allocate`, { method: "POST", body: JSON.stringify({ user: "Luis" }) })
      toast.success(result.message || "Received inventory allocated.")
      setReceivedAllocation(null)
      await load()
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Unable to allocate received inventory.") } finally { setSaving(false) }
  }

  const openAdjustment = () => {
    const warehouse = data.warehouses?.[0]
    const stock = (item?.warehouseStock || []).find((row) => String(row.warehouseId || "") === String(warehouse?.id || ""))
    setAdjustWarehouseId(warehouse?.id || "")
    setAdjustQuantity(String(Number(stock?.qty || 0)))
    setAdjustReason("")
    setAdjustNote("")
    setAdjustPreview(null)
    setAdjustOpen(true)
  }
  const previewAdjustment = async () => {
    if (!adjustWarehouseId || !adjustReason || Number(adjustQuantity) < 0) return
    setAdjustPreviewLoading(true)
    try {
      const result = await api<{ preview?: InventoryAdjustmentPreview }>(`/api/inventory/${encodeURIComponent(sku)}/adjustments`, {
        method: "POST",
        body: JSON.stringify({ warehouseId: adjustWarehouseId, targetQty: Number(adjustQuantity), reason: adjustReason, note: adjustNote, preview: true, user: "Luis" }),
      })
      setAdjustPreview(result.preview || null)
    } catch (reason) {
      setAdjustPreview(null)
      toast.error(reason instanceof Error ? reason.message : "Unable to review this adjustment.")
    } finally { setAdjustPreviewLoading(false) }
  }
  const applyAdjustment = async () => {
    setSaving(true)
    try {
      const result = await api<{ message?: string }>(`/api/inventory/${encodeURIComponent(sku)}/adjustments`, {
        method: "POST",
        body: JSON.stringify({ warehouseId: adjustWarehouseId, targetQty: Number(adjustQuantity), reason: adjustReason, note: adjustNote, user: "Luis" }),
      })
      toast.success(result.message || "Inventory adjusted.")
      setAdjustOpen(false)
      await load()
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Unable to adjust inventory.") } finally { setSaving(false) }
  }
  if (loading) return <div className="grid gap-4"><Skeleton className="h-10 w-44" /><Skeleton className="h-40" /><Skeleton className="h-96" /></div>
  if (error || !item) return <div className="grid gap-4"><Button variant="outline" className="w-fit" asChild><a href="/inventory">Back to Inventory</a></Button><Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Inventory record unavailable</AlertTitle><AlertDescription>{error || "This SKU was not found."}</AlertDescription></Alert></div>
  const available = Number(metrics.physicalAvailable || 0)
  const receivingWarehouse = (data.warehouses || []).find((warehouse) => warehouse.id === receiveWarehouseId)
  const receivingBins = (receivingWarehouse?.bins || []).filter((bin) => bin.active !== false && bin.code)
  const receivingBinRequired = receivingWarehouse?.requireBinValidation === true && receivingBins.length > 0
  const signalTone = (severity?: string) => severity === "critical" ? "border-red-500/40 bg-red-500/10" : severity === "warning" ? "border-amber-500/40 bg-amber-500/10" : "border-emerald-500/40 bg-emerald-500/10"
  return <div className="grid gap-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="outline" asChild><a href="/inventory">Back to Inventory</a></Button><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" asChild><a href={`/products/${encodeURIComponent(item.sku || sku)}`}>Open product</a></Button><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="size-4" /> Refresh</Button><Button size="sm" variant="outline" onClick={openAdjustment}>Adjust inventory</Button><Button size="sm" variant="outline" onClick={openReceive}>Receive inventory</Button><Button size="sm" onClick={openAllocation}>Assign stock</Button></div></div>
    <Card><CardContent className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_auto]"><div><p className="text-xs font-semibold uppercase text-muted-foreground">Inventory control / SKU</p><h1 className="mt-1 text-2xl font-semibold">{item.sku}</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{item.marketplaceTitle || item.title || "Untitled product"}</p><div className="mt-3 flex flex-wrap gap-2"><Badge variant={available > 0 ? "default" : "destructive"}>{numberLabel(available)} physical available</Badge><Badge variant="outline">{numberLabel(metrics.allocatedUnits)} allocated</Badge><Badge variant="outline">{numberLabel(metrics.incomingUnits)} incoming</Badge><Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">{numberLabel(metrics.supplierAvailable)} supplier feed</Badge>{(item.replenishableEffective ?? item.replenishable) && <Badge variant="secondary">Replenishable</Badge>}</div></div><div className="grid grid-cols-2 gap-2 text-sm"><Detail label="Supplier" value={item.supplier || item.vendor || "-"} /><Detail label="Last movement" value={dateLabel(metrics.lastMovementAt)} /></div></CardContent></Card>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{(data.health || []).map((signal) => <button key={signal.id} type="button" onClick={() => setTab(signal.tab || "overview")} className={`rounded-md border p-3 text-left transition-colors hover:border-primary ${signalTone(signal.severity)}`}><div className="flex items-start gap-2">{signal.severity === "success" ? <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" /> : <AlertTriangle className={`mt-0.5 size-4 ${signal.severity === "critical" ? "text-red-600" : "text-amber-600"}`} />}<div><p className="text-sm font-semibold">{signal.title}</p><p className="mt-1 text-xs text-muted-foreground">{signal.detail}</p></div></div></button>)}</div>
    <Tabs value={tab} onValueChange={setTab}><div className="overflow-x-auto rounded-md border bg-card p-1"><TabsList className="h-auto min-w-max justify-start bg-transparent p-0"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="allocations">Allocations ({(data.allocations || []).length})</TabsTrigger><TabsTrigger value="orders">Orders ({(data.orders || []).length})</TabsTrigger><TabsTrigger value="purchase-orders">Purchase orders ({(data.purchaseOrders || []).length})</TabsTrigger><TabsTrigger value="returns">Returns ({(data.returns || []).length})</TabsTrigger><TabsTrigger value="movement">Change log</TabsTrigger></TabsList></div>
      <TabsContent value="overview" className="mt-4 grid gap-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6"><Detail label="Available to promise" value={numberLabel(metrics.physicalAvailable)} /><Detail label="Open demand" value={numberLabel(metrics.openOrderUnits)} /><Detail label="Projected after POs" value={numberLabel(metrics.projectedAvailable)} /><Detail label="30-day sales" value={numberLabel(metrics.shipped30)} /><Detail label="Daily sell rate" value={Number(metrics.averageDaily30 || 0).toFixed(2)} /><Detail label="Days of cover" value={metrics.daysOfCover == null ? "No sales signal" : `${Number(metrics.daysOfCover).toFixed(1)} days`} /><Detail label="30-day sell-through" value={`${(Number(metrics.sellThrough30 || 0) * 100).toFixed(1)}%`} /><Detail label="90-day returns" value={numberLabel(metrics.returned90)} /><Detail label="90-day return rate" value={`${(Number(metrics.returnRate90 || 0) * 100).toFixed(1)}%`} /><Detail label="Open POs" value={numberLabel(metrics.openPurchaseOrderCount)} /><Detail label="Open returns" value={numberLabel(metrics.openReturnCount)} /><Detail label="Stale allocations" value={numberLabel(metrics.staleAllocationCount)} /></div><InventorySourceAwareSummary data={data} /><Card><CardHeader><CardTitle className="text-sm">Warehouse availability</CardTitle><CardDescription>Physical on hand, committed reservations, and available-to-promise by location.</CardDescription></CardHeader><CardContent><ProductWarehouseTable rows={item.warehouseStock || []} /></CardContent></Card><Card><CardHeader><CardTitle className="text-sm">Channel availability</CardTitle><CardDescription>Explains the quantity each enabled channel can publish after reservations, safety stock, allocation percentage, fixed quantity, and maximum caps.</CardDescription></CardHeader><CardContent><InventoryChannelAvailabilityTable rows={data.channelAvailability || []} /></CardContent></Card></TabsContent>
      <TabsContent value="allocations" className="mt-4"><Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="text-sm">Order allocations</CardTitle><CardDescription>Reassign stock that has not shipped, or release it back to available inventory.</CardDescription></div><Button size="sm" onClick={openAllocation}>Assign stock</Button></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Customer</TableHead><TableHead>Warehouse</TableHead><TableHead>Qty</TableHead><TableHead>Age</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{(data.allocations || []).map((allocation) => <TableRow key={allocation.id}><TableCell className="font-medium"><a className="text-primary hover:underline" href={`/orders/${encodeURIComponent(allocation.orderId || "")}`}>{allocation.orderNumber || allocation.orderId}</a></TableCell><TableCell>{allocation.buyer || "-"}</TableCell><TableCell>{allocation.warehouseName || "-"}</TableCell><TableCell>{numberLabel(allocation.qty)}</TableCell><TableCell>{dateLabel(allocation.updatedAt || allocation.assignedAt)}</TableCell><TableCell><div className="flex justify-end gap-2"><Button size="sm" variant="outline" disabled={saving || !eligibleOrders.some((order) => order.id !== allocation.orderId)} onClick={() => openReassign(allocation)}>Reassign</Button><Button size="sm" variant="outline" disabled={saving} onClick={() => allocation.id && void release(allocation.id)}>Release</Button></div></TableCell></TableRow>)}{!(data.allocations || []).length && <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No active order allocations for this SKU.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card></TabsContent>
      <TabsContent value="orders" className="mt-4"><Card><CardHeader><CardTitle className="text-sm">Order demand</CardTitle><CardDescription>Open and completed demand, catalog matching, allocation, and fulfillment history.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Customer</TableHead><TableHead>Channel</TableHead><TableHead>Status</TableHead><TableHead>Required</TableHead><TableHead>Allocated</TableHead><TableHead>Unallocated</TableHead><TableHead>Matched by</TableHead></TableRow></TableHeader><TableBody>{(data.orders || []).map((order) => <TableRow key={order.id}><TableCell className="font-medium"><a className="text-primary hover:underline" href={`/orders/${encodeURIComponent(order.id || "")}`}>{order.orderNumber || order.id}</a></TableCell><TableCell>{order.buyer || "-"}</TableCell><TableCell>{order.source || "-"}</TableCell><TableCell><Badge variant={String(order.status || "").toLowerCase().includes("fulfill") ? "default" : "outline"}>{order.status || "Open"}</Badge></TableCell><TableCell>{numberLabel(Number(order.inventoryQuantity || 0) - Number(order.inventoryFulfilledQty || 0))}</TableCell><TableCell>{numberLabel(order.inventoryAllocatedQty)}</TableCell><TableCell><Badge variant={Number(order.inventoryUnallocatedQty || 0) > 0 ? "destructive" : "outline"}>{numberLabel(order.inventoryUnallocatedQty)}</Badge></TableCell><TableCell>{order.inventoryMatchMethod || "Exact SKU"}</TableCell></TableRow>)}{!(data.orders || []).length && <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">No orders reference this SKU.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card></TabsContent>
      <TabsContent value="purchase-orders" className="mt-4"><Card><CardHeader><CardTitle className="text-sm">Purchase-order supply</CardTitle><CardDescription>Latest supplier orders, receipts, open incoming units, cost, and expected arrival.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>PO</TableHead><TableHead>Supplier</TableHead><TableHead>Status</TableHead><TableHead>Ordered</TableHead><TableHead>Received</TableHead><TableHead>Open</TableHead><TableHead>Unit cost</TableHead><TableHead>Expected</TableHead></TableRow></TableHeader><TableBody>{(data.purchaseOrders || []).map((po) => <TableRow key={`${po.id}:${po.poNumber}`}><TableCell className="font-medium"><a className="text-primary hover:underline" href={`/purchase-orders/${encodeURIComponent(po.id || "")}`}>{po.poNumber || po.id}</a></TableCell><TableCell>{po.supplier || "-"}</TableCell><TableCell><Badge variant="outline">{po.status || "Draft"}</Badge></TableCell><TableCell>{numberLabel(po.orderedQty)}</TableCell><TableCell>{numberLabel(po.receivedQty)}</TableCell><TableCell>{numberLabel(po.openQty)}</TableCell><TableCell>{moneyLabel(po.unitCost)}</TableCell><TableCell>{dateLabel(po.expectedAt || po.placedAt)}</TableCell></TableRow>)}{!(data.purchaseOrders || []).length && <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">No purchase orders contain this SKU.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card></TabsContent>
      <TabsContent value="returns" className="mt-4"><Card><CardHeader><CardTitle className="text-sm">Returns and disposition</CardTitle><CardDescription>Tracks return demand, inspection state, restocking, and return-rate signals.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Return</TableHead><TableHead>Order</TableHead><TableHead>Status</TableHead><TableHead>Qty</TableHead><TableHead>Reason</TableHead><TableHead>Condition</TableHead><TableHead>Disposition</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>{(data.returns || []).map((record) => <TableRow key={`${record.id}:${record.returnNumber}`}><TableCell className="font-medium"><a className="text-primary hover:underline" href={rmaHref(record as unknown as Record<string, unknown>)}>{record.returnNumber || record.id}</a></TableCell><TableCell>{record.orderId ? <a className="text-primary hover:underline" href={`/orders/${encodeURIComponent(record.orderId)}`}>{record.orderNumber || record.orderId}</a> : "-"}</TableCell><TableCell><Badge variant="outline">{record.status || "Open"}</Badge></TableCell><TableCell>{numberLabel(record.qty)}</TableCell><TableCell>{record.reason || "-"}</TableCell><TableCell>{record.condition || "-"}</TableCell><TableCell>{record.disposition || (record.restockedAt ? "Restocked" : "-")}</TableCell><TableCell>{dateLabel(record.updatedAt)}</TableCell></TableRow>)}{!(data.returns || []).length && <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">No returns reference this SKU.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card></TabsContent>
      <TabsContent value="movement" className="mt-4"><Card><CardHeader><CardTitle className="text-sm">Inventory change log</CardTitle><CardDescription>Receipts, audits, allocations, releases, adjustments, transfers, fulfillments, and feed changes with provenance.</CardDescription></CardHeader><CardContent><ProductInventoryLedgerRows rows={data.ledger || []} /></CardContent></Card></TabsContent>
    </Tabs>
    <Dialog open={allocateOpen} onOpenChange={setAllocateOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Assign stock to order</DialogTitle><DialogDescription>Reserve physical inventory for open demand. On-hand stock is unchanged until fulfillment.</DialogDescription></DialogHeader><div className="grid gap-4"><div className="grid gap-1"><Label>Order</Label><Select value={orderId} onValueChange={(value) => { setOrderId(value); const order = eligibleOrders.find((row) => row.id === value); if (order) setQuantity(String(order.inventoryUnallocatedQty || 1)) }}><SelectTrigger><SelectValue placeholder="Choose open demand" /></SelectTrigger><SelectContent>{eligibleOrders.filter((order) => order.id).map((order) => <SelectItem key={order.id} value={order.id || ""}>{order.orderNumber || order.id} - {order.buyer || "Customer"} ({numberLabel(order.inventoryUnallocatedQty)} needed)</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1"><Label>Warehouse</Label><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger><SelectValue placeholder="Choose warehouse" /></SelectTrigger><SelectContent>{(data.warehouses || []).filter((warehouse) => warehouse.id).map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id || ""}>{warehouse.name || warehouse.id}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1"><Label>Quantity</Label><Input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div><div className="grid gap-1"><Label>Allocation note</Label><Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional reason or instruction" /></div></div><DialogFooter><Button variant="outline" onClick={() => setAllocateOpen(false)}>Cancel</Button><Button disabled={saving || !orderId || !warehouseId || Number(quantity) <= 0} onClick={() => void allocate()}>{saving && <Loader2 className="size-4 animate-spin" />} Assign stock</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={adjustOpen} onOpenChange={(open) => { setAdjustOpen(open); if (!open) setAdjustPreview(null) }}><DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Adjust physical inventory</DialogTitle><DialogDescription>Set the actual on-hand quantity. DataPlus will show and release any order reservations that the new balance can no longer support.</DialogDescription></DialogHeader><div className="grid gap-4"><div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-1"><Label>Warehouse</Label><Select value={adjustWarehouseId} onValueChange={(value) => { const stock = (item.warehouseStock || []).find((row) => String(row.warehouseId || "") === value); setAdjustWarehouseId(value); setAdjustQuantity(String(Number(stock?.qty || 0))); setAdjustPreview(null) }}><SelectTrigger><SelectValue placeholder="Choose physical warehouse" /></SelectTrigger><SelectContent>{(data.warehouses || []).filter((warehouse) => warehouse.id).map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id || ""}>{warehouse.name || warehouse.id}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1"><Label>New on-hand quantity</Label><Input type="number" min="0" step="1" value={adjustQuantity} onChange={(event) => { setAdjustQuantity(event.target.value); setAdjustPreview(null) }} /></div></div><div className="grid gap-1"><Label>Reason</Label><Select value={adjustReason} onValueChange={(value) => { setAdjustReason(value); setAdjustPreview(null) }}><SelectTrigger><SelectValue placeholder="Choose a required reason" /></SelectTrigger><SelectContent>{inventoryAdjustmentReasonOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1"><Label>Note {adjustReason === "other" ? "(required)" : "(optional)"}</Label><Textarea value={adjustNote} onChange={(event) => { setAdjustNote(event.target.value); setAdjustPreview(null) }} placeholder="Add count details, receiving reference, or corrective context" /></div>{adjustPreview && <div className="grid gap-3 rounded-md border bg-muted/20 p-3"><div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><Detail label="Before" value={numberLabel(adjustPreview.qtyBefore)} /><Detail label="After" value={numberLabel(adjustPreview.qtyAfter)} /><Detail label="Reserved before" value={numberLabel(adjustPreview.reservedBefore)} /><Detail label="Reserved after" value={numberLabel(adjustPreview.reservedAfter)} /></div>{(adjustPreview.affectedOrders || []).length > 0 ? <Alert className="border-amber-500/40 bg-amber-500/10"><AlertTriangle className="size-4 text-amber-700 dark:text-amber-300" /><AlertTitle>{adjustPreview.affectedOrders?.length} order allocation{adjustPreview.affectedOrders?.length === 1 ? "" : "s"} will be adjusted</AlertTitle><AlertDescription><div className="mt-2 grid gap-1">{adjustPreview.affectedOrders?.map((order) => <a key={`${order.orderId}:${order.releaseQty}`} className="flex items-center justify-between rounded border bg-background/70 px-2 py-1 text-sm text-foreground hover:bg-background" href={`/orders/${encodeURIComponent(order.orderId || "")}`}><span>#{order.orderNumber || order.orderId} · {order.buyer || "Customer"}</span><span>{numberLabel(order.releaseQty)} released</span></a>)}</div></AlertDescription></Alert> : <p className="text-sm text-muted-foreground">No order allocations need to be released.</p>}</div>}</div><DialogFooter><Button variant="outline" disabled={saving || adjustPreviewLoading} onClick={() => setAdjustOpen(false)}>Cancel</Button>{!adjustPreview ? <Button disabled={adjustPreviewLoading || !adjustWarehouseId || !adjustReason || Number(adjustQuantity) < 0 || (adjustReason === "other" && !adjustNote.trim())} onClick={() => void previewAdjustment()}>{adjustPreviewLoading && <Loader2 className="size-4 animate-spin" />} Review adjustment</Button> : <Button variant={Number(adjustPreview.affectedOrders?.length || 0) > 0 ? "destructive" : "default"} disabled={saving} onClick={() => void applyAdjustment()}>{saving && <Loader2 className="size-4 animate-spin" />} Apply adjustment</Button>}</DialogFooter></DialogContent></Dialog>
    <Dialog open={receiveOpen} onOpenChange={setReceiveOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Receive physical inventory</DialogTitle><DialogDescription>Posts on-hand stock to the selected physical warehouse and creates a manual receipt plus an inventory-ledger entry. Supplier-feed availability is not changed.</DialogDescription></DialogHeader><div className="grid gap-4"><div className="rounded-md border bg-muted/20 p-3 text-sm"><p className="font-medium">{item.sku}</p><p className="mt-1 text-muted-foreground">{item.marketplaceTitle || item.title || "Catalog item"}</p></div><div className="grid gap-1"><Label>Receiving warehouse</Label><Select value={receiveWarehouseId} onValueChange={(value) => { setReceiveWarehouseId(value); setReceiveBin("") }}><SelectTrigger><SelectValue placeholder="Choose physical warehouse" /></SelectTrigger><SelectContent>{(data.warehouses || []).filter((warehouse) => warehouse.id).map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id || ""}>{warehouse.name || warehouse.id}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1"><Label>Quantity received</Label><Input type="number" min="1" value={receiveQuantity} onChange={(event) => setReceiveQuantity(event.target.value)} /></div><div className="grid gap-1"><Label>{receivingBinRequired ? "Bin location (required)" : "Bin location"}</Label>{receivingBins.length ? <Select value={receiveBin || "__none"} onValueChange={(value) => setReceiveBin(value === "__none" ? "" : value)}><SelectTrigger><SelectValue placeholder="Select bin" /></SelectTrigger><SelectContent>{!receivingBinRequired && <SelectItem value="__none">No bin</SelectItem>}{receivingBins.map((bin) => <SelectItem key={bin.id || bin.code} value={bin.code || ""}>{bin.code}{bin.name ? ` - ${bin.name}` : ""}{bin.isDefault ? " (default)" : ""}</SelectItem>)}</SelectContent></Select> : <Input value={receiveBin} onChange={(event) => setReceiveBin(event.target.value)} placeholder={receivingWarehouse?.requireBinValidation ? "Configure bins for this warehouse" : "Optional unless required by warehouse"} />}</div><div className="grid gap-1"><Label>Receiving note</Label><Input value={receiveNote} onChange={(event) => setReceiveNote(event.target.value)} placeholder="Delivery, adjustment, or receiving reference" /></div></div><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setReceiveOpen(false)}>Cancel</Button><Button disabled={saving || !receiveWarehouseId || Number(receiveQuantity) <= 0 || (receivingBinRequired && !receiveBin)} onClick={() => void receiveInventory()}>{saving && <Loader2 className="size-4 animate-spin" />} Post receipt</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(receivedAllocation)} onOpenChange={(open) => { if (!open && !saving) setReceivedAllocation(null) }}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Allocate received inventory?</DialogTitle><DialogDescription>{receivedAllocation?.receiptNumber} is posted. DataPlus can reserve the received stock for the highest-priority open orders now, or leave it available for the next routing pass.</DialogDescription></DialogHeader><div className="grid gap-4"><div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/20 p-3 text-sm sm:grid-cols-4"><div><p className="text-xs text-muted-foreground">Available</p><p className="font-semibold">{numberLabel(receivedAllocation?.preview.availableQty)}</p></div><div><p className="text-xs text-muted-foreground">Proposed</p><p className="font-semibold">{numberLabel(receivedAllocation?.preview.proposedQty)} units</p></div><div><p className="text-xs text-muted-foreground">Orders</p><p className="font-semibold">{numberLabel(receivedAllocation?.preview.proposedOrderCount)}</p></div><div><p className="text-xs text-muted-foreground">Left available</p><p className="font-semibold">{numberLabel(receivedAllocation?.preview.remainingQty)}</p></div></div>{Number(receivedAllocation?.preview.poAdjustmentQty || 0) > 0 && <Alert className="border-amber-500/40 bg-amber-500/10"><AlertTriangle className="size-4 text-amber-700 dark:text-amber-300" /><AlertTitle>Purchasing follow-up required</AlertTitle><AlertDescription>{numberLabel(receivedAllocation?.preview.poAdjustmentQty)} unit(s) are already on a submitted PO. Allocation will make the stock available for fulfillment and add a purchasing review; it will not silently cancel the supplier commitment.</AlertDescription></Alert>}<div className="max-h-64 overflow-y-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Priority order</TableHead><TableHead>Ship by</TableHead><TableHead className="text-right">Allocate</TableHead></TableRow></TableHeader><TableBody>{(receivedAllocation?.preview.candidates || []).map((candidate) => <TableRow key={`${candidate.orderId}:${candidate.title}`}><TableCell><a className="font-medium text-primary hover:underline" href={`/orders/${encodeURIComponent(candidate.orderId || "")}`}>{candidate.orderNumber || candidate.orderId}</a><p className="text-xs text-muted-foreground">{candidate.buyer || "Customer"}{candidate.requiresPoAdjustment ? " · PO review" : ""}</p></TableCell><TableCell>{candidate.shipBy ? dateLabel(candidate.shipBy) : "Oldest order first"}</TableCell><TableCell className="text-right font-medium">{numberLabel(candidate.proposedQty)}</TableCell></TableRow>)}{!(receivedAllocation?.preview.candidates || []).length && <TableRow><TableCell colSpan={3} className="h-20 text-center text-muted-foreground">No eligible open order currently needs this SKU.</TableCell></TableRow>}</TableBody></Table></div><p className="text-xs text-muted-foreground">Priority is earliest ship-by date, then oldest order date. Choosing receive only keeps this stock available for future paid orders.</p></div><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setReceivedAllocation(null)}>Receive only</Button><Button disabled={saving || Number(receivedAllocation?.preview.proposedQty || 0) <= 0} onClick={() => void allocateReceivedInventory()}>{saving && <Loader2 className="size-4 animate-spin" />} Allocate by priority</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={reassignOpen} onOpenChange={setReassignOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Reassign reserved inventory</DialogTitle><DialogDescription>Move unshipped stock from {activeAllocation?.orderNumber || "the current order"} to another open order. Both orders and the inventory log will retain the transfer.</DialogDescription></DialogHeader><div className="grid gap-4"><div className="grid gap-1"><Label>Target order</Label><Select value={orderId} onValueChange={setOrderId}><SelectTrigger><SelectValue placeholder="Choose target order" /></SelectTrigger><SelectContent>{eligibleOrders.filter((order) => order.id && order.id !== activeAllocation?.orderId).map((order) => <SelectItem key={order.id} value={order.id || ""}>{order.orderNumber || order.id} - {order.buyer || "Customer"} ({numberLabel(order.inventoryUnallocatedQty)} needed)</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1"><Label>Reserve from warehouse</Label><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger><SelectValue placeholder="Choose warehouse" /></SelectTrigger><SelectContent>{(data.warehouses || []).filter((warehouse) => warehouse.id).map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id || ""}>{warehouse.name || warehouse.id}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1"><Label>Quantity to move</Label><Input type="number" min="1" max={Number(activeAllocation?.qty || 1)} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></div><div className="grid gap-1"><Label>Reason</Label><Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Why is this allocation being moved?" /></div></div><DialogFooter><Button variant="outline" onClick={() => setReassignOpen(false)}>Cancel</Button><Button disabled={saving || !orderId || !warehouseId || Number(quantity) <= 0} onClick={() => void reassign()}>{saving && <Loader2 className="size-4 animate-spin" />} Reassign inventory</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

export function InventorySkuDetailPage() {
  const classicView = new URLSearchParams(window.location.search).get("view") === "classic"
  return classicView ? <InventorySkuDetailPageLegacy /> : <InventorySkuDetailWorkspace />
}

function ProductInventoryLedgerRows({ rows }: { rows: InventoryLedgerEntry[] }) {
  const deltaLabel = (value?: number) => `${Number(value || 0) > 0 ? "+" : ""}${numberLabel(value)}`
  const balanceLabel = (before?: number | string, after?: number | string) => before === undefined && after === undefined ? "-" : `${numberLabel(Number(before || 0))} -> ${numberLabel(Number(after || 0))}`
  return rows.length ? <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>Change</TableHead><TableHead>Source</TableHead><TableHead>Reference</TableHead><TableHead>On hand</TableHead><TableHead>Reserved</TableHead><TableHead>Changed by</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={row.id || `${row.createdAt}-${index}`}><TableCell className="whitespace-nowrap">{dateLabel(row.createdAt)}</TableCell><TableCell><Badge variant="outline">{row.type || "adjustment"}</Badge></TableCell><TableCell><p className="font-medium">{row.source || row.warehouseName || "System"}</p>{row.source && row.warehouseName && <p className="text-xs text-muted-foreground">{row.warehouseName}</p>}</TableCell><TableCell>{row.referenceNumber || row.referenceId || "-"}</TableCell><TableCell><p>{balanceLabel(row.qtyBefore, row.qtyAfter)}</p><p className="text-xs text-muted-foreground">{deltaLabel(row.quantityChange)}</p></TableCell><TableCell><p>{row.reservedBefore === undefined && row.reservedAfter === undefined ? "-" : balanceLabel(row.reservedBefore, row.reservedAfter)}</p><p className="text-xs text-muted-foreground">{deltaLabel(row.reservedChange)}</p></TableCell><TableCell>{row.user || "System"}</TableCell><TableCell className="min-w-56">{row.reason || "-"}</TableCell></TableRow>)}</TableBody></Table></div> : <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No inventory movement has been recorded for this SKU.</p>
}

export function StandaloneProductPage() {
  const sku = decodeURIComponent(window.location.pathname.replace(/^\/products\//, "").split("/")[0] || "")
  const [product, setProduct] = useState<ProductItem | null>(null)
  const [channels, setChannels] = useState<ChannelConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const returnToCatalog = () => returnToPreviousLocation("/products")
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
    loadAppReferences(["connections"])
      .then((result) => { if (!cancelled) setChannels((result.connections || []) as ChannelConnection[]) })
      .catch(() => { if (!cancelled) setChannels([]) })
    return () => { cancelled = true }
  }, [])
  if (loading) return <div className="grid gap-3"><Skeleton className="h-10 w-40" /><Skeleton className="h-36" /><Skeleton className="h-96" /></div>
  if (error || !product) return <div className="grid gap-4"><Button variant="outline" className="w-fit" onClick={returnToCatalog}>Back to Products</Button><Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Product unavailable</AlertTitle><AlertDescription>{error || "This SKU was not found in the main catalog."}</AlertDescription></Alert></div>
  if (product.sourceOnly || product.inProducts === false) return <ProductDetailSheet sourceItem={product} open standalone onOpenChange={(open) => { if (!open) returnToCatalog() }} />
  return <CompleteProductWorkspace product={product} sku={sku} channels={channels} onBack={returnToCatalog} onUpdated={setProduct} />
  /* Legacy standalone composition retained temporarily for reference.
  return <div className="grid gap-5"><Button variant="outline" className="w-fit" onClick={returnToCatalog}>Back to Products</Button><PageHeader eyebrow="Product" title={product.sku || sku} description={product.marketplaceTitle || product.title || "Untitled product"} action={<div className="flex gap-2"><Badge variant={product.active === false ? "outline" : "default"}>{product.active === false ? "Inactive" : "Active"}</Badge>{product.toBeDiscontinued && <Badge variant="destructive">Discontinued</Badge>}</div>} /><Tabs defaultValue="overview"><div className="overflow-x-auto rounded-md border bg-card p-1"><TabsList className="h-auto min-w-max justify-start bg-transparent p-0"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="content">Content</TabsTrigger><TabsTrigger value="commerce">Commerce</TabsTrigger><TabsTrigger value="shipping">Shipping</TabsTrigger><TabsTrigger value="channels">Channels</TabsTrigger><TabsTrigger value="media">Media</TabsTrigger><TabsTrigger value="all">All data</TabsTrigger></TabsList></div><TabsContent value="overview" className="mt-4 grid gap-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Detail label="Supplier" value={product.supplier || product.vendor || "-"} /><Detail label="Brand" value={product.brand || "-"} /><Detail label="Manufacturer" value={product.manufacturer || "-"} /><Detail label="Vendor SKU" value={product.vendorSku || "-"} /><Detail label="Barcode" value={product.barcode || "-"} /><Detail label="UOM" value={product.uomDisplay || product.uomName || product.uom || "Each"} /><Detail label="Main category" value={product.mainCategory || product.category || "Uncategorized"} /><Detail label="Vendor category" value={product.vendorCategory || product.sourceCategory || "-"} /></div>{product.tags?.length ? <div className="flex flex-wrap gap-1">{product.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</div> : null}</TabsContent><TabsContent value="content" className="mt-4 grid gap-4"><Card><CardHeader><CardTitle className="text-sm">Short description</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm">{product.shortDescription || "No short description."}</p></CardContent></Card><Card><CardHeader><CardTitle className="text-sm">Full description</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap text-sm leading-6">{product.longDescription || "No full description."}</p></CardContent></Card></TabsContent><TabsContent value="commerce" className="mt-4 grid gap-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Detail label="Cost" value={moneyLabel(product.cost)} /><Detail label="Sell-unit cost" value={moneyLabel(product.sellUnitCost)} /><Detail label="Website price" value={moneyLabel(product.websitePrice || product.price)} /><Detail label="List / MSRP" value={moneyLabel(product.listPrice || product.msrp)} /><Detail label="On hand" value={numberLabel(product.qty)} /><Detail label="Reserved" value={numberLabel(product.reserved)} /><Detail label="Available" value={numberLabel(Math.max(0, Number(product.qty || 0) - Number(product.reserved || 0)))} /><Detail label="Replenishable qty" value={numberLabel(product.effectiveReplenishableQty)} /></div></TabsContent><TabsContent value="shipping" className="mt-4 grid gap-4"><Alert><Truck className="size-4" /><AlertTitle>{product.shippingMethod || "Needs measurements"}</AlertTitle><AlertDescription>{product.shippingClassReason || "No shipping classification is available."}</AlertDescription></Alert><div className="grid gap-3 sm:grid-cols-2"><Card><CardHeader><CardTitle className="text-sm">Item dimensions</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-3"><Detail label="Length" value={product.itemLength ? `${product.itemLength} in` : "-"} /><Detail label="Width" value={product.itemWidth ? `${product.itemWidth} in` : "-"} /><Detail label="Height" value={product.itemHeight ? `${product.itemHeight} in` : "-"} /><Detail label="Weight" value={product.itemWeight ? `${product.itemWeight} lb` : "-"} /></CardContent></Card><Card><CardHeader><CardTitle className="text-sm">Package dimensions</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-3"><Detail label="Length" value={product.packageLength ? `${product.packageLength} in` : "-"} /><Detail label="Width" value={product.packageWidth ? `${product.packageWidth} in` : "-"} /><Detail label="Height" value={product.packageHeight ? `${product.packageHeight} in` : "-"} /><Detail label="Weight" value={product.packageWeight ? `${product.packageWeight} lb` : "-"} /></CardContent></Card></div></TabsContent><TabsContent value="channels" className="mt-4 grid gap-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Detail label="Shopify ID" value={product.shopifyId || "Not linked"} /><Detail label="Shopify status" value={product.shopifyStatus || "-"} /><Detail label="Published" value={product.shopifyPublished ? "Yes" : "No"} /><Detail label="Live price" value={moneyLabel(product.shopifyLivePrice)} /><Detail label="Live inventory" value={numberLabel(product.shopifyLiveInventoryQuantity)} /><Detail label="eBay status" value={product.ebayListing?.status || "Not listed"} /><Detail label="eBay offer" value={product.ebayListing?.offerId || "-"} /><Detail label="eBay listing" value={product.ebayListing?.listingId || "-"} /></div></TabsContent><TabsContent value="media" className="mt-4 grid gap-4"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">{imageUrls.map((src, index) => <a key={`${src}-${index}`} href={src} target="_blank" rel="noreferrer" className="aspect-square overflow-hidden rounded-md border bg-muted"><img src={src} alt={`${product.sku} ${index + 1}`} className="size-full object-contain" /></a>)}</div>{!imageUrls.length && <p className="rounded-md border p-4 text-sm text-muted-foreground">No product images are available.</p>}</TabsContent><TabsContent value="all" className="mt-4"><div className="overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>Field</TableHead><TableHead>Value</TableHead></TableRow></TableHeader><TableBody>{allFields.map(([key, value]) => <TableRow key={key}><TableCell className="w-64 font-medium">{key}</TableCell><TableCell className="whitespace-pre-wrap break-words">{fieldValue(value)}</TableCell></TableRow>)}</TableBody></Table></div></TabsContent></Tabs></div>
  */
}

function StandaloneProductWorkspace({ product, sku, onBack }: { product: ProductItem; sku: string; onBack: () => void }) {
  const imageUrls = catalogImageUrlList(product.images || [])
  const primaryImage = catalogImageUrlValue(product.defaultImage) || imageUrls[0] || ""
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
        <div className="grid gap-4 xl:grid-cols-2">{section("Inventory & replenishment", "Available sellable inventory and SKU-level replenishment behavior.", <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Detail label="On hand" value={numberLabel(product.qty ?? product.stockQty)} /><Detail label="Reserved" value={numberLabel(product.reserved)} /><Detail label="Available" value={numberLabel(available)} /><Detail label="Replenishable qty" value={numberLabel(product.effectiveReplenishableQty)} /><Detail label="Replenishable" value={(product.replenishableEffective ?? product.replenishable) ? "Enabled" : "Off"} /><Detail label="Rule mode" value={product.replenishableUseVendorRules ? "Vendor default" : "SKU rule"} /></div>)}{section("Channel readiness", "Current marketplace linkage and publish state.", <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Detail label="Shopify status" value={product.shopifyStatus || "Not linked"} /><Detail label="Published" value={product.shopifyPublished ? "Yes" : "No"} /><Detail label="Live price" value={moneyLabel(product.shopifyLivePrice)} /><Detail label="Live inventory" value={numberLabel(product.shopifyLiveInventoryQuantity)} /><Detail label="eBay" value={product.ebayListing?.status || "Not listed"} /><Detail label="Shadow SKUs" value={numberLabel(product.shadowSkuCount)} /></div>)}</div>
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
  const [ebayEditorOpen, setEbayEditorOpen] = useState(false)
  const [productTab, setProductTab] = useState("overview")
  const [saving, setSaving] = useState(false)
  const [channelStatusSaving, setChannelStatusSaving] = useState("")
  const [draft, setDraft] = useState<Record<string, string | boolean>>({})
  const [relationshipMode, setRelationshipMode] = useState<"alias" | "selling-unit" | "shadow" | null>(null)
  const [relationshipSku, setRelationshipSku] = useState("")
  const [relationshipMarketplace, setRelationshipMarketplace] = useState("")
  const [relationshipMarketplaceSku, setRelationshipMarketplaceSku] = useState("")
  const [relationshipUnitsPerPack, setRelationshipUnitsPerPack] = useState("1")
  const [relationshipLabel, setRelationshipLabel] = useState("")
  const [relationshipNotes, setRelationshipNotes] = useState("")
  const [inventoryAdjustmentRow, setInventoryAdjustmentRow] = useState<NonNullable<ProductItem["warehouseStock"]>[number] | null>(null)
  const imageUrls = catalogImageUrlList(product.images || [])
  const cost = Number(product.sellUnitCost ?? product.cost ?? 0), price = Number(product.websitePrice ?? product.price ?? 0), available = Math.max(0, Number(product.qty ?? product.stockQty ?? 0) - Number(product.reserved || 0))
  const ebaySellableQty = Math.max(available, Number(product.effectiveReplenishableQty || product.replenishableQty || 0))
  const ebayLifecycleBlocked = product.active === false || Boolean(product.toBeDiscontinued) || /\binactive\b|discontinued/i.test(String(product.status || ""))
  const ebayLaunchBlocked = ebayLifecycleBlocked && ebaySellableQty <= 0
  const margin = price > 0 ? ((price - cost) / price) * 100 : 0
  const pricing = product.pricingCalculation || {}
  const pricingSourceLabel = pricing.priceSource === "vendor-website-price" ? "Supplier website price" : pricing.priceSource === "minimum-allowed-price" ? "Minimum allowed price floor" : "Cost plus markup"
  const section = (title: string, description: string, children: React.ReactNode) => <Card><CardHeader className="border-b pb-3"><CardTitle className="text-sm">{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader><CardContent className="pt-4">{children}</CardContent></Card>
  const values = (rows: Array<[string, string]>) => <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{rows.map(([label, value]) => <Detail key={label} label={label} value={value || "-"} />)}</div>
  const mainCategory = String(product.mainCategory || product.category || "").trim()
  const vendorCategory = String(product.vendorCategory || product.sourceCategory || "").trim()
  const openEditor = () => { setDraft({ shippingClassOverride: product.shippingClassOverride || "", shippingOverrideReason: product.shippingOverrideReason || "", shippingPackageOverride: product.shippingPackageOverride ?? product.packageDimensionsLocked === true, shipAlone: product.shipAlone === true, marketplaceTitle: product.marketplaceTitle || product.title || "", brand: product.brand || "", manufacturer: product.manufacturer || "", mfrPartNumber: product.mfrPartNumber || "", supplier: product.supplier || product.vendor || "", supplierCode: product.supplierCode || "", vendorSku: product.vendorSku || "", mainCategory: product.mainCategory || product.category || "", sourceCategory: product.sourceCategory || "", vendorCategory: product.vendorCategory || "", condition: product.condition || "New", status: product.status || "Active", barcode: product.barcode || "", externalId: product.externalId || "", unspsc: product.unspsc || "", uom: product.uom || "", uomQty: String(product.uomQty || 1), tags: (product.tags || []).join(", "), shortDescription: product.shortDescription || "", longDescription: product.longDescription || "", bulletPoints: (product.bulletPoints || []).join("\n"), seoKeywords: product.seoKeywords || "", wildcardSearch: product.wildcardSearch || "", defaultImage: catalogImageUrlValue(product.defaultImage) || imageUrls[0] || "", images: imageUrls.join("\n"), websitePrice: String(price), cost: String(product.cost ?? 0), fobPrice: String(product.fobPrice ?? 0), listPrice: String(product.listPrice ?? product.msrp ?? 0), qty: String(product.qty ?? product.stockQty ?? 0), reserved: String(product.reserved ?? 0), reorderPoint: String(product.reorderPoint || 0), minQuantity: String(product.minQuantity || ""), quantityIncrements: String(product.quantityIncrements || ""), leadTime: String(product.leadTime || product.leadtime || ""), itemLength: String(product.itemLength || 0), itemWidth: String(product.itemWidth || 0), itemHeight: String(product.itemHeight || 0), itemWeight: String(product.itemWeight || 0), packageLength: String(product.packageLength || 0), packageWidth: String(product.packageWidth || 0), packageHeight: String(product.packageHeight || 0), packageWeight: String(product.packageWeight || 0), dimensionalWeight: String(product.dimensionalWeight || 0), countryOfOrigin: product.countryOfOrigin || "", sdsUrl: product.sdsUrl || "", stockStatus: product.stockStatus || "", stockUpdatedAt: product.stockUpdatedAt || "", lastPricesUpdateAt: product.lastPricesUpdateAt || "", lastPricesUpdateBy: product.lastPricesUpdateBy || "", hazardous: Boolean(product.hazardous), active: product.active !== false, categoryVerified: Boolean(product.categoryVerified) }); setEditorOpen(true) }
  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      const numeric = new Set(["websitePrice", "cost", "fobPrice", "listPrice", "qty", "reserved", "reorderPoint", "minQuantity", "quantityIncrements", "itemLength", "itemWidth", "itemHeight", "itemWeight", "packageLength", "packageWidth", "packageHeight", "packageWeight", "dimensionalWeight"])
      const payload: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(draft)) {
        const normalized = key === "images"
          ? catalogImageUrlList(value)
          : key === "defaultImage"
            ? catalogImageUrlValue(value)
            : key === "bulletPoints"
              ? String(value || "").split(/\r?\n/).map((point) => point.trim()).filter(Boolean)
              : numeric.has(key)
                ? Number(value || 0)
                : value
        if (["mainCategory", "category", "vendorCategory", "sourceCategory"].includes(key) && !String(normalized || "").trim()) continue
        payload[key] = normalized
      }
      const controller = new AbortController()
      const timeout = window.setTimeout(() => controller.abort(), 30000)
      const result = await api<{ item: ProductItem }>(`/api/inventory/${encodeURIComponent(product.sku || sku || product.id || "")}?response=item`, { method: "PATCH", body: JSON.stringify(payload), signal: controller.signal }).finally(() => window.clearTimeout(timeout))
      onUpdated(result.item)
      setEditorOpen(false)
      toast.success("Product details saved.")
      if (result.item.active === false || ["inactive", "disabled", "deleted"].includes(String(result.item.status).toLowerCase())) {
        toast.info("Inactive inventory protection: check Jobs for channel results.", { action: { label: "Jobs", onClick: () => { window.location.href = "/jobs" } } })
      }
    } catch (error) {
      const message = error instanceof DOMException && error.name === "AbortError"
        ? "Save confirmation timed out. Your changes may have saved. Refresh the product and check before retrying."
        : error instanceof Error ? error.message : "Unable to save product details."
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }
  const markImportReviewComplete = async () => {
    if (saving) return
    setSaving(true)
    try {
      const result = await api<{ item: ProductItem }>(`/api/inventory/${encodeURIComponent(product.sku || sku || product.id || "")}?response=item`, {
        method: "PATCH",
        body: JSON.stringify({ catalogAttentionRequired: false })
      })
      onUpdated(result.item)
      toast.success("Catalog import review completed.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to complete the catalog review.")
    } finally {
      setSaving(false)
    }
  }
  const pushShopify = async (path: string, apply: boolean, label: string) => { if (apply && product.toBeDiscontinued) return toast.error("Discontinued SKUs cannot be sent to Shopify."); try { const result = await api<{ job?: ImportJob; message?: string }>(path, { method: "POST", body: JSON.stringify({ skus: [product.sku], dryRun: !apply, apply }) }); toast.success(result.message || `${label} queued.`); if (result.job?.id) window.setTimeout(() => { window.history.pushState({}, "", "/jobs"); window.dispatchEvent(new PopStateEvent("popstate")) }, 500) } catch (error) { toast.error(error instanceof Error ? error.message : `Unable to queue ${label.toLowerCase()}.`) } }
  const pushEbay = async (dryRun: boolean) => {
    if (ebayLaunchBlocked) return toast.error("Inactive or discontinued SKUs cannot be sent to eBay unless sellable inventory is available.")
    if (ebayLifecycleBlocked) toast.warning(`This SKU is inactive or discontinued, but sellable inventory is ${numberLabel(ebaySellableQty)}. The job will record a warning.`)
    try {
      const result = await api<{ job?: ImportJob; message?: string }>("/api/ebay/listings/launch", {
        method: "POST",
        body: JSON.stringify({ skus: [product.sku], dryRun, apply: !dryRun, publish: !dryRun }),
      })
      toast.success(result.message || `eBay listing ${dryRun ? "review" : "launch"} queued.`)
      if (result.job?.id) window.setTimeout(() => { window.history.pushState({}, "", "/jobs"); window.dispatchEvent(new PopStateEvent("popstate")) }, 500)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue the eBay listing job.")
    }
  }
  useEffect(() => { const handleAction = (event: Event) => { const action = (event as CustomEvent<{ action?: string }>).detail?.action; if (action === "edit") openEditor(); if (action === "review-product") void pushShopify("/api/shopify/product-create", false, "Product review"); if (action === "review-price") void pushShopify("/api/shopify/variant-price-push", false, "Price review"); if (action === "create-product") void pushShopify("/api/shopify/product-create", true, "Product create"); if (action === "push-price") void pushShopify("/api/shopify/variant-price-push", true, "Price push") }; window.addEventListener("dataplus:product-action", handleAction); return () => window.removeEventListener("dataplus:product-action", handleAction) }, [product.sku, product.toBeDiscontinued])
  const sourceRows = Object.entries({
    "Created at": product.createdAt || "",
    "Created by": product.createdBy || "DataPlus",
    "Creation method": product.createdMethod || "Product import",
    "Creation source": product.createdSource || "Legacy catalog import",
    "Creation source detail": product.createdSourceDetail || "",
    ...(product.productManagerFields || {}),
    ...(product.original || {})
  }).slice(0, 80)
  const enabledChannels = channels.filter((channel) => channel.connected && String(channel.status || "active").toLowerCase() !== "inactive")
  const openRelationship = (mode: "alias" | "selling-unit" | "shadow") => {
    setRelationshipMode(mode)
    setRelationshipSku("")
    setRelationshipMarketplace(mode === "shadow" ? String(enabledChannels[0]?.name || "") : "")
    setRelationshipMarketplaceSku("")
    setRelationshipUnitsPerPack("1")
    setRelationshipLabel("")
    setRelationshipNotes("")
  }
  const saveRelationship = async () => {
    const relatedSku = relationshipSku.trim()
    if (!relationshipMode || !relatedSku) return toast.error("Enter the alias or shadow SKU.")
    if (relationshipMode === "shadow" && !relationshipMarketplace) return toast.error("Choose the marketplace for this shadow SKU.")
    if (relationshipMode !== "alias" && !(Number(relationshipUnitsPerPack) >= 1)) return toast.error("Pieces per sale must be at least 1.")
    if (relationshipMode === "selling-unit" && !window.confirm("Confirm the current warehouse inventory is already counted as individual pieces. DataPlus will not convert existing case quantities.")) return
    setSaving(true)
    try {
      const path = relationshipMode === "shadow" ? "shadows" : "aliases"
      const result = await api<{ item: ProductItem }>(`/api/inventory/${encodeURIComponent(product.sku || sku)}/${path}`, {
        method: "POST",
        body: JSON.stringify(relationshipMode !== "shadow"
          ? { aliasSku: relatedSku, soldAsQty: relationshipMode === "selling-unit" ? Number(relationshipUnitsPerPack) : 1, confirmPieceInventory: relationshipMode === "selling-unit", type: relationshipMode === "selling-unit" ? "sell-unit" : "direct", label: relationshipLabel.trim(), notes: relationshipNotes, source: relationshipMode === "selling-unit" ? "Manual selling unit" : "Manual product link" }
          : { shadowSku: relatedSku, marketplaceSku: relationshipMarketplaceSku.trim(), unitsPerPack: Number(relationshipUnitsPerPack), marketplace: relationshipMarketplace, notes: relationshipNotes, status: "Draft" })
      })
      onUpdated(result.item)
      setRelationshipMode(null)
      toast.success(relationshipMode === "shadow" ? `${relatedSku} was created as a ${relationshipMarketplace} shadow.` : relationshipMode === "selling-unit" ? `${relatedSku} now sells ${Number(relationshipUnitsPerPack)} pieces per order unit.` : `${relatedSku} now resolves to ${product.sku || sku}.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save the SKU relationship.")
    } finally { setSaving(false) }
  }
  const channelKey = (channel: ChannelConnection) => String(channel.name || "").toLowerCase() === "tiktok shop" ? "tiktok" : String(channel.name || "").trim().toLowerCase()
  const channelInactive = (channel: ChannelConnection) => {
    const value = product.channelSellingStatus?.[channelKey(channel)]
    return value?.inactive === true || String(value?.status || "").toLowerCase() === "inactive"
  }
  const updateChannelStatus = async (channel: ChannelConnection, status: "active" | "inactive") => {
    const key = channelKey(channel)
    if (!key || channelStatusSaving) return
    if (status === "inactive" && !window.confirm(`Set ${product.sku || sku} inactive on ${channel.name}? DataPlus will queue zero inventory and keep future ${channel.name} inventory updates at zero.`)) return
    setChannelStatusSaving(key)
    try {
      const result = await api<{ job?: ImportJob | null; message?: string }>("/api/inventory/bulk", { method: "POST", body: JSON.stringify({ ids: [product.id || product.sku || sku], action: "set-channel-status", channels: [key], status }) })
      const updated = { ...(product.channelSellingStatus || {}), [key]: { status, inactive: status === "inactive", updatedAt: new Date().toISOString() } }
      onUpdated({ ...product, channelSellingStatus: updated })
      toast.success(result.message || `${product.sku || sku} is ${status} on ${channel.name}.`)
      if (result.job?.id) toast.info("Zero-inventory protection is queued. Track it in Jobs.")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update channel status.") }
    finally { setChannelStatusSaving("") }
  }
  const ebayEnabled = enabledChannels.some((channel) => String(channel.name || "").toLowerCase() === "ebay")
  const ebayChannel = enabledChannels.find((channel) => String(channel.name || "").toLowerCase() === "ebay")
  const channelTabId = (channel: ChannelConnection) => `channel-${String(channel.id || channel.name).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
  const eBayTabActive = Boolean(ebayChannel && productTab === channelTabId(ebayChannel))
  useEffect(() => {
    if (!editorOpen || !eBayTabActive) return
    setEditorOpen(false)
    setEbayEditorOpen(true)
  }, [editorOpen, eBayTabActive])
  const readinessChecks = [
    ["Import review", product.catalogAttentionRequired !== true],
    ["Category", Boolean(product.categoryVerified)],
    ["Content", Boolean(product.shortDescription && product.longDescription)],
    ["Media", imageUrls.length > 0],
    ["Shipping", Boolean(product.shippingMethod && ((product.shippingPackageOverride ?? product.packageDimensionsLocked)
      ? product.packageWeight && product.packageLength && product.packageWidth && product.packageHeight
      : product.itemWeight && product.itemLength && product.itemWidth && product.itemHeight))],
    ["Price", price > 0 && cost > 0],
    ["Shopify", Boolean(product.shopifyId || product.toBeDiscontinued)],
  ] as const
  const readinessScore = Math.round((readinessChecks.filter(([, ready]) => ready).length / readinessChecks.length) * 100)
  return <div className="relative grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
    <ProductReadinessPanel score={readinessScore} checks={readinessChecks} discontinued={Boolean(product.toBeDiscontinued)} />
    <div className="flex flex-wrap items-center justify-between gap-3"><Button variant="outline" onClick={onBack}>Back to Products</Button><div className="flex flex-wrap gap-2"><Badge variant={product.active === false ? "outline" : "default"}>{product.active === false ? "Inactive" : "Active"}</Badge>{product.categoryVerified ? <Badge variant="outline">Category verified</Badge> : <Badge variant="outline">Category needs review</Badge>}{product.toBeDiscontinued ? <Badge variant="destructive">Discontinued</Badge> : null}<Button size="sm" onClick={openEditor}><Pencil className="size-4" /> Edit product</Button><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline"><MoreHorizontal className="size-4" /> Actions</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>Shopify</DropdownMenuLabel><DropdownMenuItem onClick={() => void pushShopify("/api/shopify/product-create", false, "Shopify launch review")}><ShoppingBag className="size-4" /> Review Shopify launch</DropdownMenuItem><DropdownMenuItem disabled={product.toBeDiscontinued || Boolean(product.shopifyId)} onClick={() => void pushShopify("/api/shopify/product-create", true, "Shopify product launch")}><ShoppingBag className="size-4" /> {product.shopifyId ? "Already in Shopify" : "Launch on Shopify"}</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => void pushShopify("/api/shopify/variant-price-push", false, "Shopify price review")}><ShoppingBag className="size-4" /> Review Shopify price</DropdownMenuItem><DropdownMenuItem disabled={product.toBeDiscontinued || !product.shopifyId} onClick={() => void pushShopify("/api/shopify/variant-price-push", true, "Shopify price push")}><ShoppingBag className="size-4" /> Push Shopify price</DropdownMenuItem>{ebayEnabled && <><DropdownMenuSeparator /><DropdownMenuLabel>eBay</DropdownMenuLabel><DropdownMenuItem onClick={() => void pushEbay(true)}><ShoppingBag className="size-4" /> Review eBay launch</DropdownMenuItem><DropdownMenuItem disabled={ebayLaunchBlocked} onClick={() => void pushEbay(false)}><ShoppingBag className="size-4" /> Launch on eBay</DropdownMenuItem></>}<DropdownMenuSeparator /><DropdownMenuItem onClick={() => { window.history.pushState({}, "", "/jobs"); window.dispatchEvent(new PopStateEvent("popstate")) }}><History className="size-4" /> View channel jobs</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div>
    {product.catalogAttentionRequired ? <Alert className="border-amber-500/40 bg-amber-500/10"><AlertCircle className="size-4" /><AlertTitle>Created by DataPlus from an order import</AlertTitle><AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><span>{product.catalogAttentionReason || "This draft SKU still needs catalog review. Complete its identity, supplier, cost, content, and shipping data, or link the imported SKU as an alias of an existing product."}</span><Button size="sm" variant="outline" disabled={saving} onClick={() => void markImportReviewComplete()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Mark reviewed</Button></AlertDescription></Alert> : null}
    <Card><CardContent className="grid gap-5 p-5 lg:grid-cols-[180px_minmax(0,1fr)]"><div className="grid aspect-square place-items-center overflow-hidden rounded-md border bg-muted/40">{product.defaultImage || imageUrls[0] ? <img src={product.defaultImage || imageUrls[0]} alt={product.title || sku} className="size-full object-contain p-3" /> : <Boxes className="size-10 text-muted-foreground" />}</div><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{product.catalogAttentionRequired ? "System-created draft product" : "Approved catalog product"}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">{product.marketplaceTitle || product.title || "Untitled product"}</h1><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"><strong className="font-mono text-foreground">{product.sku || sku}</strong><span>{product.brand || "No brand"}</span><span>{product.supplier || product.vendor || "No supplier"}</span><span>{product.uomDisplay || "Each"}</span></div><ProductCategoryPopover category={mainCategory} sourceCategory={vendorCategory} />{product.tags?.length ? <div className="mt-3 flex flex-wrap gap-1">{product.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}</div> : null}</div></CardContent></Card>
    {(product.sellingUnits?.explicit || (product.systemVariants?.length || 0) > 1) && <section className="min-w-0 border-b pb-4">
      <div className="mb-2 flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">Selling units</h2><Badge variant="outline">{product.sellingUnits?.individual ? 'Individual unit allowed' : 'Supplier case rules apply'}</Badge><Button size="sm" variant="outline" onClick={() => openRelationship("selling-unit")}><Boxes className="size-4" /> Add sold-as option</Button></div>
      <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Option</TableHead><TableHead>SKU</TableHead><TableHead>Units per sale</TableHead></TableRow></TableHeader><TableBody>{(product.systemVariants || []).map(unit => <TableRow key={unit.sku}><TableCell>{unit.optionValue || unit.uomDisplay}</TableCell><TableCell className="whitespace-normal break-all">{unit.sku}</TableCell><TableCell>{unit.uomQty}</TableCell></TableRow>)}{!product.systemVariants?.length && <TableRow><TableCell colSpan={3}>No selling unit permitted. Review supplier rules and product minimum quantity.</TableCell></TableRow>}</TableBody></Table></div>
    </section>}
    <Tabs className="min-w-0" value={productTab} onValueChange={setProductTab}><div className="overflow-x-auto rounded-md border bg-card p-1"><TabsList className="h-auto min-w-max justify-start bg-transparent p-0"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="content">Content</TabsTrigger><TabsTrigger value="identifiers">Identifiers</TabsTrigger><TabsTrigger value="pricing">Pricing</TabsTrigger><TabsTrigger value="inventory">Inventory</TabsTrigger><TabsTrigger value="shipping">Shipping & compliance</TabsTrigger>{enabledChannels.map((channel) => <TabsTrigger key={channel.id || channel.name} value={channelTabId(channel)}>{channel.name}</TabsTrigger>)}<TabsTrigger value="offers">Variants & related SKUs</TabsTrigger><TabsTrigger value="suppliers">Suppliers</TabsTrigger><TabsTrigger value="source">Source & history</TabsTrigger></TabsList></div>
      <TabsContent value="overview" className="mt-4 grid gap-4"><div className="grid gap-4 xl:grid-cols-2">{section("Identity & category", "Core catalog, supplier, and classification fields.", values([["SKU", product.sku || sku], ["Vendor SKU", product.vendorSku || ""], ["Brand", product.brand || ""], ["Manufacturer", product.manufacturer || ""], ["Mfr part number", product.mfrPartNumber || ""], ["Supplier", product.supplier || product.vendor || ""], ["Main category", product.mainCategory || product.category || ""], ["UPC / barcode", product.barcode || ""], ["UNSPSC", String(product.unspsc || "")], ["Selling UOM", product.uomDisplay || product.uom || "Each"]]))}{section("Pricing", "The current primary sell-unit price and its source.", values([["Sell-unit cost", moneyLabel(pricing.primarySellUnitCost ?? product.sellUnitCost)], ["Website price", moneyLabel(price)], ["Gross profit", moneyLabel(price - cost)], ["Margin", `${margin.toFixed(1)}%`], ["Pricing source", pricingSourceLabel], ["Last price update", product.lastPricesUpdateAt ? dateLabel(product.lastPricesUpdateAt) : "Not recorded"], ["Updated by", product.lastPricesUpdateBy || "Not recorded"], ["List / MSRP", moneyLabel(product.listPrice || product.msrp)]]))}</div>{section("Product content", "Customer-facing merchandising summary.", <div className="grid gap-4"><div><p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Short description</p><p className="whitespace-pre-wrap text-sm leading-6">{product.shortDescription || "No short description has been prepared."}</p></div><Separator /><div><p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Long description</p><p className="line-clamp-4 whitespace-pre-wrap text-sm leading-6">{product.longDescription || "No long description has been prepared."}</p></div></div>)}<div className="grid gap-4 xl:grid-cols-2">{section("Inventory & status", "Sellable stock, replenishment, and product state.", values([["On hand", numberLabel(product.qty ?? product.stockQty)], ["Reserved", numberLabel(product.reserved)], ["Available", numberLabel(available)], ["Reorder point", numberLabel(product.reorderPoint)], ["Replenishable", (product.replenishableEffective ?? product.replenishable) ? "Enabled" : "Off"], ["Replenishable qty", numberLabel(product.effectiveReplenishableQty)], ["Product status", product.toBeDiscontinued ? "Discontinued" : product.status || (product.active === false ? "Inactive" : "Active")], ["Stock updated", product.stockUpdatedAt ? dateLabel(product.stockUpdatedAt) : "Not recorded"]]))}{section("Dimensions & shipping", "Physical product and shipment measurements.", values([["Item dimensions", product.itemLength && product.itemWidth && product.itemHeight ? `${product.itemLength} x ${product.itemWidth} x ${product.itemHeight} in` : "Not recorded"], ["Item weight", product.itemWeight ? `${product.itemWeight} lb` : "Not recorded"], ["Package dimensions", product.packageLength && product.packageWidth && product.packageHeight ? `${product.packageLength} x ${product.packageWidth} x ${product.packageHeight} in` : "Not recorded"], ["Package weight", product.packageWeight ? `${product.packageWeight} lb` : "Not recorded"], ["Country of origin", product.countryOfOrigin || "Not recorded"], ["Shipping class", product.shippingClass || "Not classified"], ["Shipping method", product.shippingMethod || "Not classified"], ["Dimensional weight", product.dimensionalWeight ? `${product.dimensionalWeight} lb` : "Not calculated"], ["Last record update", product.updatedAt ? dateLabel(product.updatedAt) : "Not recorded"]]))}</div></TabsContent>
      <TabsContent value="content" className="mt-4 grid gap-4">{section("Descriptions & search", "Customer content and internal search fields.", <div className="grid gap-4"><div><p className="mb-1 text-sm font-medium">Short description</p><p className="whitespace-pre-wrap text-sm text-muted-foreground">{product.shortDescription || "No short description."}</p></div><div><p className="mb-1 text-sm font-medium">Long description</p><p className="whitespace-pre-wrap text-sm text-muted-foreground">{product.longDescription || "No long description."}</p></div><div><p className="mb-1 text-sm font-medium">Bullet points</p>{product.bulletPoints?.length ? <ul className="list-disc space-y-1 pl-5 text-sm">{product.bulletPoints.map((point, index) => <li key={`${point}-${index}`}>{point}</li>)}</ul> : <p className="text-sm text-muted-foreground">No bullet points.</p>}</div>{values([["SEO keywords", product.seoKeywords || ""], ["Wildcard search", product.wildcardSearch || ""], ["Condition", product.condition || "New"], ["Country of origin", product.countryOfOrigin || ""]])}</div>)}</TabsContent>
      <TabsContent value="identifiers" className="mt-4 grid gap-4">{section("Primary identifiers", "Keys used to match supplier, catalog, and marketplace records.", values([["Internal SKU", product.sku || sku], ["External ID", product.externalId || ""], ["Vendor SKU", product.vendorSku || ""], ["Supplier code", product.supplierCode || ""], ["Manufacturer", product.manufacturer || ""], ["Mfr part number", product.mfrPartNumber || ""], ["UPC / GTIN", product.barcode || ""], ["UNSPSC", product.unspsc || ""], ["UOM", product.uomDisplay || product.uomName || product.uom || "Each"], ["Source status", product.stockStatus || product.status || ""]]))}{section("Additional identifiers", "Supplier and marketplace identifiers retained with this product record.", <ProductIdentifiersTable rows={product.identifiers || []} />)}{section("SKU aliases", "Alternate internal or imported SKUs that resolve to this product.", <ProductAliases rows={product.aliases || []} />)}</TabsContent>
      <TabsContent value="pricing" className="mt-4 grid gap-4">{section("Pricing calculation", "The actual rule sequence used to calculate the primary Shopify sell-unit price.", <><div className="mb-4 rounded-md border bg-muted/30 p-3 text-sm"><span className="font-medium">{pricingSourceLabel}:</span>{" "}{pricing.priceSource === "vendor-website-price" ? "a valid supplier website price overrides the calculated markup price." : pricing.priceSource === "minimum-allowed-price" ? "the configured minimum allowed price is higher than the calculated markup price." : `sell-unit cost x (1 + ${Number(pricing.markupPercent ?? 28).toFixed(0)}% markup).`}</div>{values([["Rule cost basis", pricing.costBasis === "sell-unit" ? "Sell unit" : "Each unit"], ["Primary sell unit", pricing.sellUnit || product.uomDisplay || "Each"], ["Source cost", moneyLabel(pricing.sourceCost ?? product.sourceCost ?? product.cost)], ["Sell-unit cost", moneyLabel(pricing.sellUnitCost ?? product.sellUnitCost)], ["Price basis", moneyLabel(pricing.primarySellUnitCost ?? product.sellUnitCost)], ["Markup", `${Number(pricing.markupPercent ?? 28).toFixed(0)}%`], ["Calculated markup price", moneyLabel(pricing.markedUpPrice)], ["Supplier website price", moneyLabel(pricing.vendorWebsitePrice)], ["Minimum allowed price", pricing.minimumAllowedPriceEnforced ? moneyLabel(pricing.minimumAllowedPrice) : "Not enforced"], ["LTL freight allowance", moneyLabel(pricing.freightAllowance ?? 0)], ["Final DataPlus price", moneyLabel(pricing.finalPrice ?? price)], ["Last price update", product.lastPricesUpdateAt ? dateLabel(product.lastPricesUpdateAt) : "Not recorded"], ["Updated by", product.lastPricesUpdateBy || "Not recorded"]])}</>)}{section("Price status & channel comparison", "Current product price compared with the connected Shopify variant.", values([["FOB", moneyLabel(product.fobPrice)], ["List / MSRP", moneyLabel(product.listPrice || product.msrp)], ["Shopify system price", moneyLabel(product.shopifySystemPrice)], ["Shopify live price", moneyLabel(product.shopifyLivePrice)], ["Live price difference", moneyLabel(product.shopifyPriceDelta ?? undefined)], ["Price sync", product.shopifyPriceMismatch ? "Needs review" : product.shopifyId ? "Matched" : "Not linked"], ["Product record updated", product.updatedAt ? dateLabel(product.updatedAt) : "Not recorded"], ["Stock updated", product.stockUpdatedAt ? dateLabel(product.stockUpdatedAt) : "Not recorded"]]))}{section("Shopify purchase variants", "Actual UOM-based sell units; Essendant stays UOM-only.", <ProductVariantsTable rows={product.shopifyPurchaseVariants || []} />)}</TabsContent>
      <TabsContent value="inventory" className="mt-4 grid gap-4">{section("Inventory operations", "Open orders, reservations, movement, velocity, and fulfillment history for this SKU.", <Button asChild size="sm"><a href={`/inventory/${encodeURIComponent(product.sku || sku)}`}>View full inventory details</a></Button>)}{section("Warehouse stock", "Warehouse-level quantities and reorder thresholds.", <ProductWarehouseTable rows={product.warehouseStock || []} onAdjust={setInventoryAdjustmentRow} />)}{section("Stock ledger", "SKU-specific inventory movement and adjustment history.", <ProductInventoryLedger sku={product.sku || sku} />)}{section("Recent product changes", "Latest recorded import and operational changes.", <ProductChangesTable rows={product.recentChanges || []} />)}</TabsContent>
      <TabsContent value="shipping" className="mt-4 grid gap-4"><Alert><Truck className="size-4" /><AlertTitle>{product.shippingMethod || product.shippingClass || "Needs measurements"}</AlertTitle><AlertDescription>{product.shippingClassReason || "Enter product measurements to classify shipping."} Product dimensions are preferred; package measurements fill missing values or replace them when the override is enabled.</AlertDescription></Alert><div className="grid gap-4 xl:grid-cols-2">{section("Default shipping dimensions", "The individual sell unit measurements used for rates and labels.", values([["Length", product.itemLength ? `${product.itemLength} in` : ""], ["Width", product.itemWidth ? `${product.itemWidth} in` : ""], ["Height", product.itemHeight ? `${product.itemHeight} in` : ""], ["Weight", product.itemWeight ? `${product.itemWeight} lb` : ""], ["Ship alone", product.shipAlone ? "Yes" : "No"], ["Preference saved", product.shippingPreferencesSavedAt ? dateLabel(product.shippingPreferencesSavedAt) : "Default behavior"], ["Saved by", product.shippingPreferencesSavedBy || "Not recorded"]]))}{section("Package override", product.shippingPackageOverride ?? product.packageDimensionsLocked ? "Enabled. These measurements replace the product defaults." : "Off. Saved package values are used only when product measurements are missing.", values([["Status", product.shippingPackageOverride ?? product.packageDimensionsLocked ? "Override enabled" : "Product first, package fallback"], ["Length", product.packageLength ? `${product.packageLength} in` : ""], ["Width", product.packageWidth ? `${product.packageWidth} in` : ""], ["Height", product.packageHeight ? `${product.packageHeight} in` : ""], ["Weight", product.packageWeight ? `${product.packageWeight} lb` : ""], ["Saved", product.packageDimensionsSavedAt ? dateLabel(product.packageDimensionsSavedAt) : "Not manually saved"], ["Saved by", product.packageDimensionsSavedBy || "Not recorded"]]))}</div>{section("Compliance", "Regulatory and shipping documentation.", values([["Dimensional weight", product.dimensionalWeight ? `${product.dimensionalWeight} lb` : ""], ["Hazardous", product.hazardous ? "Yes" : "No"], ["SDS", product.sdsUrl ? "Available" : "Missing"], ["Country of origin", product.countryOfOrigin || ""]]))}</TabsContent>
      {enabledChannels.map((channel) => { const inactive = channelInactive(channel); const key = channelKey(channel); return <TabsContent key={channel.id || channel.name} value={channelTabId(channel)} className="mt-4 grid gap-4"><Alert className={inactive ? "border-amber-500/40 bg-amber-500/10" : "border-emerald-500/40 bg-emerald-500/10"}><Power className="size-4" /><AlertTitle>{inactive ? `Inactive on ${channel.name}` : `Active on ${channel.name}`}</AlertTitle><AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><span>{inactive ? "DataPlus sends zero inventory for this SKU on this channel until it is reactivated." : "Normal launch and inventory rules apply to this SKU on this channel."}</span><Button size="sm" variant={inactive ? "default" : "outline"} disabled={Boolean(channelStatusSaving)} onClick={() => void updateChannelStatus(channel, inactive ? "active" : "inactive")}>{channelStatusSaving === key && <Loader2 className="size-4 animate-spin" />}{inactive ? "Set channel active" : "Set channel inactive"}</Button></AlertDescription></Alert><ProductPricePolicy sku={product.sku || sku} channel={channel} /><ProductChannelPanel channel={channel} product={product} section={section} values={values} onEditEbay={String(channel.name || "").toLowerCase() === "ebay" ? () => setEbayEditorOpen(true) : undefined} /></TabsContent> })}
      <TabsContent value="offers" className="mt-4 grid gap-4">{section("Selling units", "Supplier UOM plus manual sold-as quantities. Every sold-as SKU draws from the same piece inventory.", <div className="grid gap-3"><div><Button size="sm" onClick={() => openRelationship("selling-unit")}><Boxes className="size-4" /> Add sold-as option</Button></div><ProductVariantsTable rows={product.systemVariants || []} /></div>)}{section("Aliases & marketplace shadows", "Add alternate identities or channel-specific records that share this product's inventory.", <div className="grid gap-4"><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => openRelationship("alias")}><Link2 className="size-4" /> Add alias</Button><Button size="sm" variant="outline" onClick={() => openRelationship("shadow")}><Copy className="size-4" /> Create shadow</Button></div><div className="grid gap-4 lg:grid-cols-2"><ProductAliases rows={product.aliases || []} /><ProductShadows rows={product.shadowSkus || []} /></div></div>)}</TabsContent>
      <TabsContent value="suppliers" className="mt-4 grid gap-4">{section("Supplier coverage", "Supplier source records ranked by product identity, not merely a catalog alternate count.", <ProductSupplierCoverage product={product} active={productTab === "suppliers"} />)}</TabsContent>
      <TabsContent value="source" className="mt-4 grid gap-4">{section("Source catalog & audit", "Raw supplier fields and import history remain available for review.", <><ProductChangesTable rows={product.recentChanges || []} /><div className="mt-4 overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>Source field</TableHead><TableHead>Value</TableHead></TableRow></TableHeader><TableBody>{sourceRows.map(([key, value]) => <TableRow key={key}><TableCell className="w-64 font-medium">{key}</TableCell><TableCell className="max-w-xl whitespace-pre-wrap break-words">{typeof value === "object" ? JSON.stringify(value) : String(value ?? "-")}</TableCell></TableRow>)}{!sourceRows.length && <TableRow><TableCell colSpan={2} className="py-8 text-center text-muted-foreground">No raw source fields are stored for this product.</TableCell></TableRow>}</TableBody></Table></div></>)}</TabsContent>
    </Tabs><ProductEditorDialog open={editorOpen} onOpenChange={setEditorOpen} initialTab={productTab === "content" ? "content" : productTab === "pricing" || productTab === "inventory" ? "pricing" : productTab === "shipping" ? "shipping" : productTab === "source" ? "audit" : "basics"} draft={draft} setDraft={setDraft} saving={saving} onSave={save} />
    <Dialog open={Boolean(relationshipMode)} onOpenChange={(open) => { if (!open) setRelationshipMode(null) }}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{relationshipMode === "shadow" ? "Create marketplace shadow" : relationshipMode === "selling-unit" ? "Add sold-as option" : "Add SKU alias"}</DialogTitle><DialogDescription>{relationshipMode === "shadow" ? `Create a marketplace pack that draws inventory from ${product.sku || sku}.` : relationshipMode === "selling-unit" ? `Create another purchasable quantity that draws from ${product.sku || sku}.` : `Make another SKU resolve directly to ${product.sku || sku} for imports, orders, and fulfillment.`}</DialogDescription></DialogHeader><div className="grid gap-4">{relationshipMode === "shadow" ? <><div className="grid gap-4 sm:grid-cols-2"><Field label="DataPlus shadow SKU"><Input autoFocus value={relationshipSku} onChange={(event) => setRelationshipSku(event.target.value)} placeholder={`${product.sku || sku}-3PK`} /></Field><Field label="Marketplace SKU"><Input value={relationshipMarketplaceSku} onChange={(event) => setRelationshipMarketplaceSku(event.target.value)} placeholder="B084P9759D" /></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Marketplace"><Select value={relationshipMarketplace} onValueChange={setRelationshipMarketplace}><SelectTrigger><SelectValue placeholder="Choose marketplace" /></SelectTrigger><SelectContent>{enabledChannels.map((channel) => <SelectItem key={channel.id || channel.name} value={String(channel.name)}>{channel.name}</SelectItem>)}</SelectContent></Select></Field><Field label="Pieces per ordered pack"><Input type="number" min="1" step="1" value={relationshipUnitsPerPack} onChange={(event) => setRelationshipUnitsPerPack(event.target.value)} /></Field></div></> : relationshipMode === "selling-unit" ? <div className="grid gap-4 sm:grid-cols-2"><Field label="Selling-unit SKU"><Input autoFocus value={relationshipSku} onChange={(event) => setRelationshipSku(event.target.value)} placeholder={`${product.sku || sku}-12PK`} /></Field><Field label="Pieces per sale"><Input type="number" min="1" step="1" value={relationshipUnitsPerPack} onChange={(event) => setRelationshipUnitsPerPack(event.target.value)} /></Field><div className="sm:col-span-2"><Field label="Display label (optional)"><Input value={relationshipLabel} onChange={(event) => setRelationshipLabel(event.target.value)} placeholder={`Pack of ${Math.max(1, Number(relationshipUnitsPerPack) || 1)}`} /></Field></div></div> : <Field label="Alias SKU"><Input autoFocus value={relationshipSku} onChange={(event) => setRelationshipSku(event.target.value)} placeholder="Marketplace or legacy SKU" /></Field>}<Field label="Notes (optional)"><Textarea value={relationshipNotes} onChange={(event) => setRelationshipNotes(event.target.value)} placeholder="Why this SKU relationship exists" /></Field><Alert><Link2 className="size-4" /><AlertTitle>{relationshipMode === "alias" ? "Same product identity" : "Shared piece inventory"}</AlertTitle><AlertDescription>{relationshipMode === "alias" ? "Use an alias only when both SKUs identify the exact same product and selling unit." : `Each order unit will reserve and deduct ${Math.max(1, Number(relationshipUnitsPerPack) || 1)} piece${Math.max(1, Number(relationshipUnitsPerPack) || 1) === 1 ? "" : "s"} from the parent. Existing inventory counts are not converted.`}</AlertDescription></Alert></div><DialogFooter><Button variant="outline" onClick={() => setRelationshipMode(null)}>Cancel</Button><Button disabled={saving || !relationshipSku.trim() || (relationshipMode === "shadow" && !relationshipMarketplace) || (relationshipMode !== "alias" && !(Number(relationshipUnitsPerPack) >= 1))} onClick={() => void saveRelationship()}>{saving ? <Loader2 className="size-4 animate-spin" /> : relationshipMode === "shadow" ? <Copy className="size-4" /> : relationshipMode === "selling-unit" ? <Boxes className="size-4" /> : <Link2 className="size-4" />}{relationshipMode === "shadow" ? "Create shadow" : relationshipMode === "selling-unit" ? "Add sold-as option" : "Add alias"}</Button></DialogFooter></DialogContent></Dialog>
    <ProductInventoryAdjustmentDialog sku={product.sku || sku} row={inventoryAdjustmentRow} onOpenChange={(open) => { if (!open) setInventoryAdjustmentRow(null) }} onAdjusted={(item) => { onUpdated(item); setInventoryAdjustmentRow(null) }} />
    {ebayChannel ? <EbayListingWorkspace open={ebayEditorOpen} onOpenChange={setEbayEditorOpen} product={product} channel={ebayChannel} onUpdated={onUpdated} /> : null}
  </div>
}

function ProductReadinessPanel({ score, checks, discontinued }: { score: number; checks: ReadonlyArray<readonly [string, boolean]>; discontinued: boolean }) { const missing = checks.filter(([, ready]) => !ready).map(([label]) => label); const label = discontinued ? "Blocked" : score === 100 ? "Ready" : `${missing.length} item${missing.length === 1 ? "" : "s"} need attention`; return <Card className="order-first lg:absolute lg:right-5 lg:top-[72px] lg:z-10 lg:w-[44%]"><CardContent className="grid gap-3 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">Product readiness</p><p className="text-xs text-muted-foreground">{discontinued ? "Discontinued products cannot be published." : label}</p></div><Badge variant={discontinued ? "destructive" : score === 100 ? "success" : "warning"}>{discontinued ? "Blocked" : `${score}%`}</Badge></div><Progress value={score} className="h-2" /><div className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">{checks.map(([label, ready]) => <div key={label} className={ready ? "text-foreground" : "text-muted-foreground"}><span className={ready ? "mr-1 text-emerald-600" : "mr-1 text-amber-600"}>{ready ? "Ready" : "Needs"}</span>{label}</div>)}</div></CardContent></Card> }

function EbayCategoryComparisonCard({ comparison }: { comparison?: ProductItem["ebayCategoryComparison"] }) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<EbayCategoryCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [resultsFromDavid, setResultsFromDavid] = useState(false)
  const currentSku = decodeURIComponent(window.location.pathname.split("/").pop() || "")
  const status = comparison?.status || "not-configured"
  const state = status === "match"
    ? { label: "Matched", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200", description: "The current eBay category matches the local DataPlus mapping." }
    : status === "different"
      ? { label: "Needs review", className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200", description: "eBay is using a different category than the local mapping." }
      : status === "live-only"
        ? { label: "Live only", className: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200", description: "eBay reported a category, but DataPlus has no local mapping yet." }
        : status === "local-only"
          ? { label: "Local only", className: "border-violet-500/40 bg-violet-500/10 text-violet-800 dark:text-violet-200", description: "DataPlus has a mapping, but no imported eBay category is available." }
          : { label: "Not configured", className: "border-muted-foreground/30 bg-muted text-muted-foreground", description: "Run the eBay catalog sync or add a local eBay category mapping." }
  const categoryText = (entry?: { id?: string; path?: string; name?: string }) => entry?.path || entry?.name || entry?.id || "Not available"
  useEffect(() => {
    setQuery((current) => current || comparison?.local?.path || comparison?.live?.path || "")
  }, [comparison?.local?.path, comparison?.live?.path])
  const search = async (viaDavid = false) => {
    const value = query.trim()
    if (!value) {
      setError("Enter a product phrase or category first.")
      return
    }
    setSearching(true)
    setError("")
    setNotice("")
    try {
      const result = await api<{ categories?: EbayCategoryCandidate[]; message?: string; warning?: string }>(
        viaDavid ? "/api/ai/ebay-category-research" : `/api/channel-taxonomies/ebay/categories?q=${encodeURIComponent(value)}&limit=20&marketplaceId=EBAY_US`,
        viaDavid ? { method: "POST", body: JSON.stringify({ query: value, marketplaceId: "EBAY_US", product: { sku: currentSku, title: value, mainCategory: value } }) } : undefined,
      )
      const categories = Array.isArray(result.categories) ? result.categories : []
      setResults(categories)
      setResultsFromDavid(viaDavid && categories.length > 0)
      setNotice(result.warning || "")
      if (!categories.length) setError(result.message || "No eBay taxonomy matches were found.")
      else toast.success(`${viaDavid ? "David found" : "Local taxonomy found"} ${categories.length} category matches.`)
    } catch (searchError) {
      setResults([])
      setResultsFromDavid(false)
      setError(searchError instanceof Error ? searchError.message : "Unable to search eBay categories.")
    } finally {
      setSearching(false)
    }
  }
  const useCandidate = (candidate: EbayCategoryCandidate) => {
    const categoryId = String(candidate.categoryId || candidate.id || "")
    const categoryPath = ebayCategoryCandidatePath(candidate)
    const selection = { ...candidate, categoryId, categoryPath, sku: currentSku }
    try {
      window.sessionStorage.setItem(`dataplus:ebay-category-selection:${currentSku}`, JSON.stringify(selection))
    } catch {
      // Session storage can be unavailable in embedded/private browser contexts.
    }
    window.dispatchEvent(new CustomEvent("dataplus:ebay-category-selected", { detail: selection }))
    void navigator.clipboard?.writeText(`${categoryId} - ${categoryPath}`)
    toast.success("eBay category selected. Open Edit eBay settings to review and save it.")
  }
  return <Card className="border-dashed">
    <CardHeader className="gap-2 pb-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-sm">eBay category comparison</CardTitle><CardDescription>{state.description}</CardDescription></div><div className="flex flex-wrap items-center gap-2"><Badge variant="outline" className={state.className}>{state.label}</Badge>{comparison?.local?.path ? <Button size="sm" variant="outline" className="h-8" asChild><a href={`/categories/${encodeURIComponent(comparison.local.path)}`}><ExternalLink className="size-3.5" /> View category</a></Button> : null}</div></div></CardHeader>
    <CardContent className="grid gap-3 pt-0 sm:grid-cols-2"><div className="rounded-md border bg-muted/20 p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Category on synced eBay listing</p><p className="mt-1 text-sm font-medium">{categoryText(comparison?.live)}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{comparison?.live?.id ? `ID ${comparison.live.id}` : "No synced listing category"}</p></div><div className="rounded-md border bg-muted/20 p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Selected DataPlus mapping</p><p className="mt-1 text-sm font-medium">{categoryText(comparison?.local)}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{comparison?.local?.id ? `ID ${comparison.local.id}` : "No local eBay mapping"}</p></div><div className="grid gap-2 border-t pt-3 sm:col-span-2"><div><p className="text-sm font-medium">Search cached eBay taxonomy</p><p className="text-xs text-muted-foreground">Searches the eBay US category index stored in DataPlus. David ranks candidates from this same cache; neither action performs a live eBay lookup.</p></div><div className="flex flex-col gap-2 sm:flex-row"><Input className="border-slate-300 bg-slate-100/80 shadow-sm focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 dark:border-slate-600 dark:bg-slate-950/80" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search() }} placeholder="e.g. cordless drill, hand tools" /><Button type="button" variant="outline" onClick={() => void search()} disabled={searching || !query.trim()}>{searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Search cached categories</Button><Button type="button" variant="secondary" onClick={() => void search(true)} disabled={searching || !query.trim()}><MessageSquare className="size-4" /> Ask David</Button></div>{notice ? <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">{notice}</p> : null}{error ? <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Local category lookup failed</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}{results.length ? <div className={`grid max-h-72 gap-2 overflow-y-auto rounded-md border p-2 ${resultsFromDavid ? "ai-result-surface" : ""}`}>{resultsFromDavid ? <p className="px-1 text-xs font-semibold">David's ranked results</p> : null}{results.map((candidate, index) => { const id = String(candidate.categoryId || candidate.id || ""); const path = ebayCategoryCandidatePath(candidate); return <div key={`${id}-${index}`} className={`rounded-md border p-3 ${resultsFromDavid ? "border-[color:var(--ai-result-border)] bg-background/60" : "bg-background"}`}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className={`font-mono text-xs ${resultsFromDavid ? "ai-result-text" : "text-muted-foreground"}`}>ID {id || "Not returned"}</p><p className={`mt-1 text-sm font-medium leading-5 ${resultsFromDavid ? "ai-result-text" : ""}`}>{path}</p></div><Button type="button" size="sm" onClick={() => useCandidate(candidate)}><CheckCircle2 className="size-4" /> Use in eBay editor</Button></div></div> })}</div> : null}</div></CardContent>
    {comparison?.checkedAt ? <CardFooter className="border-t pt-3 text-xs text-muted-foreground">Last checked {dateLabel(comparison.checkedAt)}</CardFooter> : null}
  </Card>
}

export function PriceModeSelect({ value, onChange, inherit = false, disabled = false }: { value: string; onChange: (value: string) => void; inherit?: boolean; disabled?: boolean }) {
  return <Select value={value} onValueChange={onChange} disabled={disabled}><SelectTrigger aria-label="Minimum-price rule"><SelectValue /></SelectTrigger><SelectContent>{inherit && <SelectItem value="inherit">Inherit</SelectItem>}<SelectItem value="protected">MAP/LAP protected</SelectItem><SelectItem value="calculated">Calculated only (ignore MAP/LAP)</SelectItem></SelectContent></Select>
}

function ProductPricePolicy({ sku, channel }: { sku: string; channel: ChannelConnection }) {
  const supported = ["shopify", "ebay", "walmart"].includes(channel.name.toLowerCase())
  const ebayRequired = channel.name.toLowerCase() === "ebay"
  const [data, setData] = useState<{ mode: string; effective: { mode: string; source: string }; floors: { floor: number } } | null>(null)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState("inherit")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const endpoint = `/api/inventory/${encodeURIComponent(sku)}/pricing-rule/${encodeURIComponent(channel.id)}`
  useEffect(() => { let cancelled = false; setData(null); setError(""); if (supported) api<typeof data>(endpoint).then(value => { if (!cancelled) setData(value) }).catch(error => { if (!cancelled) setError(String(error.message || error)) }); return () => { cancelled = true } }, [endpoint, supported])
  if (!supported) return null
  async function save() {
    setSaving(true)
    try { const result = await api<NonNullable<typeof data>>(endpoint, { method: "PATCH", body: JSON.stringify({ mode }) }); setData(result); setOpen(false); toast.success("Pricing rule saved. Run a price sync to update the live listing.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save pricing rule") } finally { setSaving(false) }
  }
  return <Card><CardHeader><CardTitle className="text-base">{channel.name} pricing rule</CardTitle><CardDescription>{ebayRequired ? "eBay always protects MAP, LAP, and source minimum prices." : "SKU override for this channel only. Applies to its selling variants."}</CardDescription></CardHeader><CardContent className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0 text-sm">{data ? <><p>{data.effective.mode === "protected" ? "MAP/LAP protected" : "Calculated only"} · Rule source: {data.effective.source}</p><p className="text-xs text-muted-foreground">Saved override: {data.mode}. Source minimum: {moneyLabel(data.floors.floor)} before selling-quantity conversion.</p></> : <p>{error || "Loading pricing rule…"}</p>}</div>{!ebayRequired && <Button variant="outline" disabled={!data} onClick={() => { setMode(data?.mode || "inherit"); setOpen(true) }}>Edit pricing rule</Button>}</CardContent><Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>{channel.name} SKU pricing</DialogTitle><DialogDescription>Inherit follows the brand rule, then channel settings. Protected uses the higher of the calculated total and the source minimum. Calculated only ignores MAP/LAP.</DialogDescription></DialogHeader><PriceModeSelect value={mode} onChange={setMode} inherit disabled={saving} /><p className="text-sm text-muted-foreground">Saving changes the next price calculation. It does not publish or update the live listing immediately.</p><DialogFooter><Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>Save rule</Button></DialogFooter></DialogContent></Dialog></Card>
}

function ProductChannelPanel({ channel, product, section, values, onEditEbay }: { channel: ChannelConnection; product: ProductItem; section: (title: string, description: string, children: React.ReactNode) => React.ReactNode; values: (rows: Array<[string, string]>) => React.ReactNode; onEditEbay?: () => void }) {
  const [walmartMatchOpen, setWalmartMatchOpen] = useState(false)
  const [walmartLaunchOpen, setWalmartLaunchOpen] = useState(false)
  const name = String(channel.name || "Channel")
  const kind = name.toLowerCase()
  if (kind === "walmart") {
    const listing = ((product as ProductItem & Record<string, unknown>).walmartListing || {}) as Record<string, unknown>
    const rows: Array<[string, string]> = [["Linked by", listing.matchMethod === "sku" ? "Exact SKU" : listing.matchMethod === "upc" ? "UPC/GTIN" : "-"], ["Feed ID", String(listing.feedId || "")], ["Ingestion", String(listing.ingestionStatus || "")], ["Last check", String(listing.checkedAt || "")]]
    return section("Walmart Marketplace", "Feed acceptance and ingestion do not confirm live publication. Verify the seller listing after ingestion.", <><WalmartListingStatus key={product.sku} sku={product.sku || ""} sellerSku={String(listing.sku || product.sku || "")} linked={Boolean(listing.sku)} />{values(rows)}<WalmartCatalogMatch sku={product.sku || ""} refreshKey={walmartMatchOpen} /><WalmartReadiness sku={product.sku || ""} />{listing.ingestionErrors ? <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(listing.ingestionErrors, null, 2)}</pre> : null}<div className="mt-4 flex flex-wrap gap-2"><Button variant="outline" onClick={() => setWalmartMatchOpen(true)}><Search className="size-4" />Match on Walmart by UPC</Button><Button onClick={() => void launchWalmartExisting({ skus: [product.sku || ""] })}>Launch against existing Walmart catalog</Button><Button variant="outline" onClick={() => setWalmartLaunchOpen(true)}>Review new-item launch</Button></div><WalmartUpcMatch skus={[product.sku || ""]} open={walmartMatchOpen} onOpenChange={setWalmartMatchOpen} /><WalmartLaunch sku={product.sku || ""} open={walmartLaunchOpen} onOpenChange={setWalmartLaunchOpen} /></>)
  }
  if (kind === "shopify") {
    const shopifySku = String(product.shopifyLiveVariantSku || product.shopifyVariantSku || "").trim()
    const normalizedShopifySku = shopifySku.toLowerCase()
    const matchedSystemVariant = (product.systemVariants || []).find((variant) => String(variant.sku || "").trim().toLowerCase() === normalizedShopifySku)
    const matchedPurchaseVariant = (product.shopifyPurchaseVariants || []).find((variant) => String(variant.shopifyVariantSku || variant.sku || "").trim().toLowerCase() === normalizedShopifySku)
    const matchedLocalSku = normalizedShopifySku && (String(product.sku || "").trim().toLowerCase() === normalizedShopifySku || matchedSystemVariant || matchedPurchaseVariant) ? String(product.sku || "") : ""
    const productRows: Array<[string, string]> = [["Product ID", product.shopifyId || "Not linked"], ["Variant ID", product.shopifyVariantId || "Not linked"], ["Handle", product.shopifyHandle || ""], ["Variant SKU", shopifySku], ["Status", product.shopifyStatus || "Not linked"], ["Published", product.shopifyPublished ? "Yes" : "No"], ["Published at", product.shopifyPublishedAt ? dateLabel(product.shopifyPublishedAt) : ""], ["Last Shopify update", product.shopifyUpdatedAt ? dateLabel(product.shopifyUpdatedAt) : ""], ["Last paired", product.shopifySyncedAt ? dateLabel(product.shopifySyncedAt) : ""], ["Sync source", product.shopifySyncSource || ""], ["Product variants", numberLabel(product.shopifyVariantCount)], ["Storefront", product.shopifyOnlineStoreUrl || "Not available"]]
    const commerceRows: Array<[string, string]> = [["DataPlus price", moneyLabel(product.shopifySystemPrice ?? product.websitePrice ?? product.price)], ["Live Shopify price", moneyLabel(product.shopifyLivePrice)], ["Compare-at price", moneyLabel(product.shopifyLiveCompareAtPrice ?? undefined)], ["Price difference", moneyLabel(product.shopifyPriceDelta ?? undefined)], ["Price match", product.shopifyPriceMismatch ? "Needs review" : "Matched"], ["Live inventory", numberLabel(product.shopifyLiveInventoryQuantity)], ["Inventory variant", product.shopifyLiveVariantSku || ""], ["Selling UOM", product.uomDisplay || "Each"]]
    return <>{section("Shopify product pair", "The parent product and sellable variant linked to this DataPlus SKU.", <><div className="mb-4 grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-2"><div><p className="text-xs font-medium text-muted-foreground">Shopify SKU</p><p className="mt-1 font-mono text-sm">{shopifySku || "Not provided"}</p></div><div><p className="text-xs font-medium text-muted-foreground">Matching local SKU</p>{matchedLocalSku ? <a className="mt-1 inline-block font-mono text-sm font-medium text-primary hover:underline" href={`/products/${encodeURIComponent(matchedLocalSku)}`}>{matchedLocalSku}</a> : <p className="mt-1 flex items-center gap-1 text-sm text-amber-700"><AlertCircle className="size-4" /> No local SKU match</p>}</div></div>{values(productRows)}</>)}{section("Shopify commercial values", "Channel-specific price, inventory, and UOM sell-unit information for this product.", <><div className="mb-4">{values(commerceRows)}</div><ProductVariantsTable rows={product.shopifyPurchaseVariants || []} /></>)}</>
  }

  if (kind === "ebay") {
    const ebay = product.ebayListing || {}
    const ebayOperatorState = ebayListingOperatorState(product)
    const settings = channel.settings || {}
    const overrides = ebay.settings || {}
    const usesChannelDefaults = overrides.useChannelDefaults !== false
    const effectiveSettings: Record<string, unknown> = usesChannelDefaults ? { ...settings } : { ...settings, ...overrides }
    const configuredValue = (listingKey: keyof NonNullable<ProductItem["ebayListing"]>, settingKey: string, fallback = "") => usesChannelDefaults ? effectiveSettings[settingKey] ?? fallback : ebay[listingKey] ?? effectiveSettings[settingKey] ?? fallback
    const policyLabel = (entries: Array<{ id?: string; name?: string; description?: string }> | undefined, id: unknown, fallback: string) => {
      const value = String(id || "").trim()
      if (!value) return fallback
      const match = (entries || []).find((entry) => String(entry.id || "") === value)
      return match ? `${match.name || value}${match.description ? ` - ${match.description}` : ""}` : value
    }
    const locationKey = String(configuredValue("merchantLocationKey", "ebayMerchantLocationKey") || "").trim()
    const location = (settings.ebayMerchantLocations || []).find((entry) => String(entry.merchantLocationKey || "") === locationKey)
    const paymentPolicyId = configuredValue("paymentPolicyId", "ebayPaymentPolicyId")
    const returnPolicyId = configuredValue("returnPolicyId", "ebayReturnPolicyId")
    const fulfillmentPolicyId = configuredValue("fulfillmentPolicyId", "ebayFulfillmentPolicyId")
    const comparison = product.ebayCategoryComparison
    const listingRows: Array<[string, string]> = [["Settings source", usesChannelDefaults ? "Channel defaults" : "SKU override"], ["Operator status", ebayOperatorState.label], ["Blocking reason", ebayOperatorState.state === "attention" ? ebayOperatorState.detail : ""], ["Remote eBay status", ebay.ebayStatus || ebay.status || "Not verified"], ["Last verified live", ebay.liveVerifiedAt ? dateLabel(ebay.liveVerifiedAt) : "Never"], ["Verification source", ebay.liveVerificationSource || ""], ["Block type", ebay.publishBlockCode || ""], ["Block field", ebay.publishBlockField || ""], ["Suggested fix", ebay.publishSuggestedFix || ""], ["Auto retry eligible", ebay.publishRetryable ? "Yes" : ebay.publishBlocked ? "No" : ""], ["Public listing ID", ebay.listingId || "Not live"], ["API offer ID", ebay.offerId || ""], ["Listing URL", ebay.listingUrl || ""], ["Marketplace", String(configuredValue("marketplaceId", "ebayMarketplaceId", "EBAY_US"))], ["Merchant location", locationKey], ["Promotion status", ebay.promotionStatus || (effectiveSettings.ebayPromotedListingsEnabled ? "Pending" : "Disabled")], ["Promotion campaign", ebay.promotionCampaignId || ""], ["Promotion error", ebay.promotionError || ""], ["Local category ID", comparison?.local?.id || String(overrides.ebayCategoryId || "")], ["Local category path", comparison?.local?.path || String(overrides.ebayCategoryPath || "")], ["Live eBay category ID", comparison?.live?.id || ""], ["Live eBay category path", comparison?.live?.path || comparison?.live?.name || ""], ["Taxonomy version", ebay.taxonomyVersion || String(overrides.ebayTaxonomyVersion || "")], ["Condition", String(configuredValue("condition", "ebayDefaultCondition", product.condition || "New"))], ["Last publish error", ebay.publishErrorAt ? dateLabel(ebay.publishErrorAt) : ""], ["Last listing update", ebay.updatedAt ? dateLabel(ebay.updatedAt) : ""], ["Attributes synced", ebay.attributesSyncedAt ? dateLabel(ebay.attributesSyncedAt) : ""]]
    const promotedRate = effectiveSettings.ebayPromotedListingsEnabled ? Number(effectiveSettings.ebayPromotedListingsRatePercent ?? 2) : 0
    const estimatedAdFee = ebay.price === undefined ? null : Math.round(Number(ebay.price || 0) * promotedRate) / 100
    const commerceRows: Array<[string, string]> = [["Listing price", ebay.price === undefined ? "Not listed" : `${ebay.currency || configuredValue("currency", "ebayCurrency", "USD")} ${moneyLabel(ebay.price)}`], ["Listing quantity", ebay.quantity === undefined ? "Not listed" : numberLabel(ebay.quantity)], ["Price rule", String(effectiveSettings.ebayPricingMode || "cost-plus")], ["Markup", `${numberLabel(Number(effectiveSettings.ebayPriceMarkupPercent || 0))}%`], ["Minimum margin", `${numberLabel(Number(effectiveSettings.ebayMinMarginPercent || 0))}%`], ["Minimum price", moneyLabel(Number(effectiveSettings.ebayMinimumPrice || 0))], ["Promoted Listings", effectiveSettings.ebayPromotedListingsEnabled ? "Enabled" : "Off"], ["Ad rate", promotedRate ? `${numberLabel(promotedRate)}%` : "-"], ["Estimated ad fee", estimatedAdFee === null ? "Not listed" : moneyLabel(estimatedAdFee)], ["Rounding", String(effectiveSettings.ebayRoundingRule || "none")], ["Quantity rule", String(effectiveSettings.ebayQuantityMode || "available")], ["Best offer", configuredValue("bestOfferEnabled", "ebayBestOfferEnabled") ? "Enabled" : "Off"], ["Auto publish", effectiveSettings.ebayAutoPublish ? "Enabled" : "Off"], ["Require image", effectiveSettings.ebayRequireImage === false ? "Off" : "Enabled"], ["DataPlus price", moneyLabel(product.websitePrice ?? product.price)], ["Available quantity", numberLabel(Math.max(0, Number(product.qty ?? product.stockQty ?? 0) - Number(product.reserved || 0)))]]
    const policyRows: Array<[string, string]> = [["Merchant location", location ? `${location.name || locationKey}${location.status ? ` / ${location.status}` : ""}` : locationKey || "Not selected"], ["Payment policy", policyLabel(settings.ebayPaymentPolicies, paymentPolicyId, "Not selected")], ["Return policy", policyLabel(settings.ebayReturnPolicies, returnPolicyId, "Not selected")], ["Shipping / fulfillment policy", policyLabel(settings.ebayFulfillmentPolicies, fulfillmentPolicyId, "Not selected")], ["Description source", String(effectiveSettings.ebayDescriptionSource || "longDescription")], ["Maximum images", numberLabel(Number(effectiveSettings.ebayMaxImages ?? 12))]]
    return <><div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/25 px-4 py-3"><div className="flex flex-wrap items-center gap-2"><Badge variant={ebayOperatorState.state === "live" ? "default" : ebayOperatorState.state === "attention" ? "secondary" : "outline"}>{ebayOperatorState.label}</Badge><Badge variant={usesChannelDefaults ? "outline" : "default"}>{usesChannelDefaults ? "Using eBay defaults" : "SKU override"}</Badge><p className="text-sm text-muted-foreground">{ebayOperatorState.detail}</p></div><div className="flex flex-wrap items-center gap-2">{ebay.listingUrl ? <Button asChild type="button" size="sm" variant="outline"><a href={ebay.listingUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> View on eBay</a></Button> : null}{onEditEbay ? <Button type="button" size="sm" variant="outline" onClick={onEditEbay}><Pencil className="size-4" /> Edit eBay settings</Button> : null}</div></div><EbayCategoryComparisonCard comparison={comparison} />{section("eBay SKU controls", "The individual price and inventory behavior DataPlus will send with this offer.", values([["Pricing source", overrides.ebayUseDefaultPricingFormula !== false ? "eBay channel pricing formula" : "SKU eBay price"], ["SKU eBay price", overrides.ebayUseDefaultPricingFormula !== false ? "Not used" : moneyLabel(Number(overrides.ebayPrice ?? overrides.ebayManualPrice ?? 0))], ["Quantity source", overrides.ebayUseChannelDefaultQuantity !== false ? `eBay channel rule (${String(effectiveSettings.ebayQuantityMode || "available")})` : "Actual available inventory"], ["Actual available", numberLabel(Math.max(0, Number(product.qty ?? product.stockQty ?? 0) - Number(product.reserved || 0)))]]))}{section("eBay listing connection", "Public listing state first; API offer ID is shown only for troubleshooting prepared or blocked records.", values(listingRows))}{section("eBay commercial settings", "Product-level pricing, quantity, and publishing behavior used for this listing.", values(commerceRows))}{section("eBay policy bundle", "Imported seller-account policies that will be used when this SKU is created or updated on eBay.", values(policyRows))}</>
  }
  const shadowRows = (product.shadowSkus || []).filter((shadow) => String(shadow.marketplace || shadow.company || "").toLowerCase() === kind)
  const channelRows: Array<[string, string]> = [["Connection", channel.connected ? "Enabled" : "Disabled"], ["Channel status", channel.status || "Active"], ["Default status", String(channel.settings?.defaultShadowStatus || "Draft")], ["Default handling days", String(channel.settings?.defaultHandlingTimeDays ?? "")], ["Default safety quantity", String(channel.settings?.defaultSafetyQty ?? "")], ["Default replenishable quantity", String(channel.settings?.defaultReplenishableQty ?? 1)], ["Default max sellable qty", String(channel.settings?.defaultMaxSellableQty ?? "")], ["Default shipping profile", String(channel.settings?.defaultShippingProfile || "")], ["Default shipping service", String(channel.settings?.defaultShippingService || "")]]
  return <>{section(`${name} channel record`, "Channel configuration and any marketplace-specific SKU record available for this product.", values(channelRows))}{section(`${name} SKU records`, "Marketplace shadows created for this product.", <ProductShadows rows={shadowRows} />)}</>
}

function ProductIdentifiersTable({ rows }: { rows: Array<Record<string, unknown>> }) { return rows.length ? <div className="overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Value</TableHead><TableHead>Source</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>{rows.map((row, index) => { const type = row.type || row.kind || row.name || row.key || "Identifier"; const value = row.value || row.identifier || row.code || row.id || "-"; const source = row.source || row.provider || row.channel || "-"; const updatedAt = row.updatedAt || row.createdAt || row.updated_at; return <TableRow key={`${String(type)}-${String(value)}-${index}`}><TableCell className="font-medium">{String(type)}</TableCell><TableCell className="font-mono text-xs">{String(value)}</TableCell><TableCell>{String(source)}</TableCell><TableCell>{updatedAt ? dateLabel(String(updatedAt)) : "-"}</TableCell></TableRow> })}</TableBody></Table></div> : <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No additional identifiers are stored for this product.</p> }
function ProductVariantsTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  return rows.length ? <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Variant SKU</TableHead><TableHead>Option</TableHead><TableHead>UOM / quantity</TableHead><TableHead>Unit cost</TableHead><TableHead>DataPlus price</TableHead><TableHead>Shopify live</TableHead><TableHead>Difference</TableHead><TableHead>Price status</TableHead><TableHead>Publication</TableHead></TableRow></TableHeader><TableBody>{rows.map((row, index) => {
    const systemPrice = Number(row.price ?? 0)
    const livePrice = row.shopifyLivePrice === null || row.shopifyLivePrice === undefined || row.shopifyLivePrice === "" ? null : Number(row.shopifyLivePrice)
    const delta = livePrice === null || !Number.isFinite(livePrice) ? null : Math.round((livePrice - systemPrice) * 100) / 100
    const matched = delta !== null && Math.abs(delta) < 0.01
    return <TableRow key={`${String(row.shopifyVariantSku || row.sku || "variant")}-${index}`}><TableCell className="font-mono text-xs">{String(row.shopifyVariantSku || row.sku || "-")}</TableCell><TableCell>{[row.optionName, row.optionValue].filter(Boolean).join(": ") || "Default"}</TableCell><TableCell>{String(row.uomDisplay || row.uomQty || "Each")}</TableCell><TableCell>{moneyLabel((row.unitCost ?? row.cost) as number)}</TableCell><TableCell className="font-medium">{moneyLabel(systemPrice)}</TableCell><TableCell>{livePrice === null ? "Not linked" : moneyLabel(livePrice)}</TableCell><TableCell>{delta === null ? "-" : <span className={matched ? "text-emerald-700 dark:text-emerald-300" : delta > 0 ? "font-medium text-amber-700 dark:text-amber-300" : "font-medium text-rose-700 dark:text-rose-300"}>{delta > 0 ? "+" : ""}{moneyLabel(delta)}</span>}</TableCell><TableCell>{livePrice === null ? <Badge variant="outline">Not linked</Badge> : <Badge className={matched ? "border-emerald-500/45 bg-emerald-500/15 text-emerald-800 hover:bg-emerald-500/15 dark:text-emerald-200" : "border-amber-500/45 bg-amber-500/15 text-amber-800 hover:bg-amber-500/15 dark:text-amber-200"} variant="outline">{matched ? "Matched" : "Review"}</Badge>}</TableCell><TableCell>{row.shopifyPublished ? "Storefront live" : row.shopifyVariantId ? "Catalog only" : String(row.shopifyStatus || row.status || "Not linked")}</TableCell></TableRow>
  })}</TableBody></Table></div> : <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No variants are configured.</p>
}
function ProductInventoryLedger({ sku }: { sku: string }) {
  const [data, setData] = useState<InventoryOperationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError("")
    api<InventoryOperationData>(`/api/inventory/${encodeURIComponent(sku)}/operations`)
      .then((result) => { if (!cancelled) setData(result) })
      .catch((requestError) => { if (!cancelled) setError(requestError instanceof Error ? requestError.message : "Inventory details could not be loaded.") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sku])

  if (loading) return <div className="grid gap-3"><Skeleton className="h-20" /><Skeleton className="h-28" /></div>
  if (error || !data) return <p className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">{error || "Inventory details could not be loaded."}</p>

  const metrics = data.metrics || {}
  const health = (data.health || []).slice(0, 3)
  const purchaseOrders = (data.purchaseOrders || []).slice(0, 4)
  const allocations = (data.allocations || []).slice(0, 4)
  const movements = (data.ledger || []).slice(0, 6)
  const signalClass = (severity?: string) => severity === "critical"
    ? "border-rose-500/40 bg-rose-500/10 text-rose-800 dark:text-rose-200"
    : severity === "warning"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200"
      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"

  return <div className="grid gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-sm font-medium">Inventory bird's-eye view</p>
        <p className="text-xs text-muted-foreground">Physical stock, supplier availability, demand, purchasing, returns, and movement in one snapshot.</p>
      </div>
      <Button asChild size="sm"><a href={`/inventory/${encodeURIComponent(sku)}`}>Open inventory workspace</a></Button>
    </div>
    {health.length ? <div className="grid gap-2 lg:grid-cols-3">{health.map((signal) => <div key={signal.id || signal.title} className={`rounded-md border px-3 py-2 ${signalClass(signal.severity)}`}><p className="text-sm font-medium">{signal.title}</p><p className="mt-0.5 text-xs opacity-80">{signal.detail}</p></div>)}</div> : null}
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
      <Detail label="Physical available" value={numberLabel(metrics.physicalAvailable)} />
      <Detail label="Allocated" value={numberLabel(metrics.allocatedUnits)} />
      <Detail label="Open demand" value={numberLabel(metrics.openOrderUnits)} />
      <Detail label="Incoming PO" value={numberLabel(metrics.incomingUnits)} />
      <Detail label="Projected ATP" value={numberLabel(metrics.projectedAvailable)} />
      <Detail label="Daily sell rate" value={Number(metrics.averageDaily30 || 0).toFixed(2)} />
      <Detail label="Days of cover" value={metrics.daysOfCover === null || metrics.daysOfCover === undefined ? "No signal" : `${Number(metrics.daysOfCover).toFixed(1)} days`} />
      <Detail label="90-day return rate" value={`${(Number(metrics.returnRate90 || 0) * 100).toFixed(1)}%`} />
    </div>
    <div className="grid gap-3 xl:grid-cols-2">
      <div className="overflow-hidden rounded-md border">
        <div className="border-b bg-muted/30 px-3 py-2"><p className="text-sm font-medium">Active allocations</p></div>
        <Table><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Warehouse</TableHead><TableHead>Qty</TableHead><TableHead>Assigned</TableHead></TableRow></TableHeader><TableBody>
          {allocations.map((row) => <TableRow key={row.id}><TableCell><a className="font-medium text-primary hover:underline" href={`/orders/${encodeURIComponent(row.orderId || "")}`}>{row.orderNumber || row.orderId}</a></TableCell><TableCell>{row.warehouseName || "-"}</TableCell><TableCell>{numberLabel(row.qty)}</TableCell><TableCell>{dateLabel(row.assignedAt)}</TableCell></TableRow>)}
          {!allocations.length && <TableRow><TableCell colSpan={4} className="h-20 text-center text-muted-foreground">No active allocations.</TableCell></TableRow>}
        </TableBody></Table>
      </div>
      <div className="overflow-hidden rounded-md border">
        <div className="border-b bg-muted/30 px-3 py-2"><p className="text-sm font-medium">Latest purchase orders</p></div>
        <Table><TableHeader><TableRow><TableHead>PO</TableHead><TableHead>Supplier</TableHead><TableHead>Status</TableHead><TableHead>Open</TableHead><TableHead>Expected</TableHead></TableRow></TableHeader><TableBody>
          {purchaseOrders.map((row) => <TableRow key={row.id}><TableCell><a className="font-medium text-primary hover:underline" href={`/purchasing/${encodeURIComponent(row.id || "")}`}>{row.poNumber || row.id}</a></TableCell><TableCell>{row.supplier || "-"}</TableCell><TableCell><Badge variant="outline">{row.status || "Open"}</Badge></TableCell><TableCell>{numberLabel(row.openQty)}</TableCell><TableCell>{dateLabel(row.expectedAt)}</TableCell></TableRow>)}
          {!purchaseOrders.length && <TableRow><TableCell colSpan={5} className="h-20 text-center text-muted-foreground">No purchase orders reference this SKU.</TableCell></TableRow>}
        </TableBody></Table>
      </div>
    </div>
    <div>
      <div className="mb-2 flex items-center justify-between"><p className="text-sm font-medium">Recent inventory changes</p><span className="text-xs text-muted-foreground">Last movement {dateLabel(metrics.lastMovementAt)}</span></div>
      <ProductInventoryLedgerRows rows={movements} />
    </div>
  </div>
}
type ProductWarehouseStockRow = NonNullable<ProductItem["warehouseStock"]>[number]

function ProductWarehouseTable({ rows, onAdjust }: { rows: ProductItem["warehouseStock"]; onAdjust?: (row: ProductWarehouseStockRow) => void }) {
  if (!rows?.length) return <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No inventory location records are available.</p>
  return <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Location</TableHead><TableHead>Type</TableHead><TableHead>Bin</TableHead><TableHead>On hand</TableHead><TableHead>Reserved</TableHead><TableHead>Available</TableHead><TableHead>Reorder</TableHead>{onAdjust ? <TableHead className="text-right">Action</TableHead> : null}</TableRow></TableHeader><TableBody>{rows.map((row, index) => {
    const physical = row.isPhysical !== false && row.inventorySourceType !== "supplier_feed" && row.aggregate !== true
    const locationName = row.warehouseName || row.warehouse || row.warehouseCode || row.warehouseId || "Unassigned warehouse"
    return <TableRow key={`${row.warehouseId || locationName}-${index}`}><TableCell><p className="font-medium">{locationName}</p>{row.warehouseCode && row.warehouseCode !== locationName ? <p className="font-mono text-xs text-muted-foreground">{row.warehouseCode}</p> : null}</TableCell><TableCell><Badge variant="outline" className={physical ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"}>{physical ? "Physical" : "Supplier feed"}</Badge></TableCell><TableCell>{row.locationBin || "-"}</TableCell><TableCell>{numberLabel(row.qty)}</TableCell><TableCell>{numberLabel(row.reserved)}</TableCell><TableCell>{numberLabel(row.available ?? Math.max(0, Number(row.qty || 0) - Number(row.reserved || 0)))}</TableCell><TableCell>{numberLabel(row.reorderPoint)}</TableCell>{onAdjust ? <TableCell className="text-right">{physical && row.warehouseId ? <Button size="sm" variant="outline" onClick={() => onAdjust(row)}>Adjust</Button> : <span className="text-xs text-muted-foreground">Read only</span>}</TableCell> : null}</TableRow>
  })}</TableBody></Table></div>
}

function ProductInventoryAdjustmentDialog({ sku, row, onOpenChange, onAdjusted }: { sku: string; row: ProductWarehouseStockRow | null; onOpenChange: (open: boolean) => void; onAdjusted: (item: ProductItem) => void }) {
  const [targetQty, setTargetQty] = useState("")
  const [reason, setReason] = useState("")
  const [note, setNote] = useState("")
  const [preview, setPreview] = useState<InventoryAdjustmentPreview | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!row) return
    setTargetQty(String(Number(row.qty || 0)))
    setReason("")
    setNote("")
    setPreview(null)
  }, [row])

  const targetNumber = Number(targetQty)
  const validTarget = targetQty.trim() !== "" && Number.isInteger(targetNumber) && targetNumber >= 0
  const canReview = Boolean(row?.warehouseId && reason && validTarget && (reason !== "other" || note.trim()))
  const updateTarget = (value: string) => { setTargetQty(value); setPreview(null) }
  const updateReason = (value: string) => { setReason(value); setPreview(null) }
  const updateNote = (value: string) => { setNote(value); setPreview(null) }
  const close = () => { if (!saving && !reviewing) onOpenChange(false) }
  const submit = async (previewOnly: boolean) => {
    if (!row?.warehouseId || !canReview) return
    previewOnly ? setReviewing(true) : setSaving(true)
    try {
      const result = await api<{ preview?: InventoryAdjustmentPreview; item?: ProductItem; message?: string }>(`/api/inventory/${encodeURIComponent(sku)}/adjustments`, {
        method: "POST",
        body: JSON.stringify({ warehouseId: row.warehouseId, targetQty: targetNumber, reason, note, preview: previewOnly, user: "Luis" }),
      })
      if (previewOnly) setPreview(result.preview || null)
      else {
        if (result.item) onAdjusted(result.item)
        else onOpenChange(false)
        toast.success(result.message || "Inventory adjusted.")
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : previewOnly ? "Unable to review this adjustment." : "Unable to adjust inventory.")
    } finally {
      previewOnly ? setReviewing(false) : setSaving(false)
    }
  }
  const locationName = row?.warehouseName || row?.warehouse || row?.warehouseCode || "Physical warehouse"
  return <Dialog open={Boolean(row)} onOpenChange={(open) => { if (!open) close() }}><DialogContent className="max-h-[95dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Adjust physical inventory</DialogTitle><DialogDescription>Set the actual on-hand quantity for {sku}. DataPlus will review any order allocations affected before applying the change.</DialogDescription></DialogHeader><div className="grid gap-4"><div className="rounded-md border bg-muted/30 p-3"><p className="font-medium">{locationName}</p>{row?.warehouseCode ? <p className="font-mono text-xs text-muted-foreground">{row.warehouseCode}</p> : null}<p className="mt-2 text-sm text-muted-foreground">Current on hand: {numberLabel(row?.qty)} · Reserved: {numberLabel(row?.reserved)}</p></div><div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-1"><Label htmlFor="product-inventory-adjust-qty">New on-hand quantity</Label><Input id="product-inventory-adjust-qty" type="number" min="0" step="1" value={targetQty} onChange={(event) => updateTarget(event.target.value)} /></div><div className="grid gap-1"><Label>Reason</Label><Select value={reason} onValueChange={updateReason}><SelectTrigger><SelectValue placeholder="Choose a required reason" /></SelectTrigger><SelectContent>{inventoryAdjustmentReasonOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div></div><div className="grid gap-1"><Label htmlFor="product-inventory-adjust-note">Note {reason === "other" ? "(required)" : "(optional)"}</Label><Textarea id="product-inventory-adjust-note" value={note} onChange={(event) => updateNote(event.target.value)} placeholder="Add count details, receiving reference, or corrective context" /></div>{preview ? <div className="grid gap-3 rounded-md border bg-muted/20 p-3"><div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><Detail label="Before" value={numberLabel(preview.qtyBefore)} /><Detail label="After" value={numberLabel(preview.qtyAfter)} /><Detail label="Reserved before" value={numberLabel(preview.reservedBefore)} /><Detail label="Reserved after" value={numberLabel(preview.reservedAfter)} /></div>{(preview.affectedOrders || []).length ? <Alert className="border-amber-500/40 bg-amber-500/10"><AlertTriangle className="size-4" /><AlertTitle>{preview.affectedOrders?.length} order allocation{preview.affectedOrders?.length === 1 ? "" : "s"} will be adjusted</AlertTitle><AlertDescription><div className="mt-2 grid gap-1">{preview.affectedOrders?.map((order) => <a key={`${order.orderId}:${order.releaseQty}`} className="flex items-center justify-between rounded border bg-background/70 px-2 py-1 text-sm text-foreground hover:bg-background" href={`/orders/${encodeURIComponent(order.orderId || "")}`}><span>#{order.orderNumber || order.orderId} · {order.buyer || "Customer"}</span><span>{numberLabel(order.releaseQty)} released</span></a>)}</div></AlertDescription></Alert> : <p className="text-sm text-muted-foreground">No order allocations need to be released.</p>}</div> : null}</div><DialogFooter><Button variant="outline" disabled={saving || reviewing} onClick={close}>Cancel</Button>{preview ? <Button variant={(preview.affectedOrders || []).length ? "destructive" : "default"} disabled={saving} onClick={() => void submit(false)}>{saving ? <Loader2 className="size-4 animate-spin" /> : null}Apply adjustment</Button> : <Button disabled={!canReview || reviewing} onClick={() => void submit(true)}>{reviewing ? <Loader2 className="size-4 animate-spin" /> : null}Review adjustment</Button>}</DialogFooter></DialogContent></Dialog>
}
function ProductChangesTable({ rows }: { rows: ProductItem["recentChanges"] }) { return rows?.length ? <div className="overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>Field</TableHead><TableHead>Previous</TableHead><TableHead>Current</TableHead></TableRow></TableHeader><TableBody>{rows.slice(0, 25).map((row, index) => <TableRow key={`${row.field}-${index}`}><TableCell>{row.updatedAt || row.createdAt || "-"}</TableCell><TableCell>{row.field || "-"}</TableCell><TableCell>{row.previousValue || "-"}</TableCell><TableCell>{row.nextValue || "-"}</TableCell></TableRow>)}</TableBody></Table></div> : <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No changes have been recorded yet.</p> }
function ProductAliases({ rows }: { rows: NonNullable<ProductItem["aliases"]> }) { return <div className="rounded-md border p-3"><p className="mb-2 text-sm font-medium">Aliases</p>{rows.length ? rows.map((row, index) => <div key={`${row.aliasSku || row.sku}-${index}`} className="flex justify-between border-t py-2 text-sm"><span>{row.aliasSku || row.sku}</span><span className="text-muted-foreground">{row.active === false ? "Inactive" : row.source || "Active"}</span></div>) : <p className="text-sm text-muted-foreground">No aliases.</p>}</div> }
function ProductShadows({ rows }: { rows: NonNullable<ProductItem["shadowSkus"]> }) { return <div className="overflow-hidden rounded-md border"><div className="border-b px-3 py-2 text-sm font-medium">Marketplace shadows</div>{rows.length ? <Table><TableHeader><TableRow><TableHead>Channel</TableHead><TableHead>Shadow SKU</TableHead><TableHead>Marketplace SKU</TableHead><TableHead className="text-right">Pack</TableHead></TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={`${row.shadowSku}-${index}`}><TableCell>{row.marketplace || row.company || "Channel"}</TableCell><TableCell className="font-mono text-xs">{row.shadowSku || "-"}</TableCell><TableCell className="font-mono text-xs">{row.marketplaceSku || "-"}</TableCell><TableCell className="text-right">{Math.max(1, Number(row.unitsPerPack || row.inventoryMultiplier || 1))} pc</TableCell></TableRow>)}</TableBody></Table> : <p className="p-3 text-sm text-muted-foreground">No shadow SKUs.</p>}</div> }
const supplierMatchPresentation: Record<string, { label: string; className: string }> = {
  primary: { label: "Primary catalog record", className: "border-sky-500/40 bg-sky-500/10 text-sky-800 dark:text-sky-200" },
  upc: { label: "UPC match", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" },
  "manufacturer-part-number": { label: "Potential MPN match", className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200" },
  "approved-mfr-part-number": { label: "Approved MPN match", className: "border-violet-500/40 bg-violet-500/10 text-violet-800 dark:text-violet-200" },
  "vendor-sku": { label: "Vendor SKU match", className: "border-blue-500/40 bg-blue-500/10 text-blue-800 dark:text-blue-200" },
  "linked-vendor-sku": { label: "Potential linked SKU", className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200" },
  "approved-vendor-sku": { label: "Approved linked SKU", className: "border-violet-500/40 bg-violet-500/10 text-violet-800 dark:text-violet-200" },
  "source-sku": { label: "Source SKU match", className: "border-cyan-500/40 bg-cyan-500/10 text-cyan-800 dark:text-cyan-200" },
  "exact-sku": { label: "Exact SKU match", className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200" },
  none: { label: "No supplier match", className: "border-muted-foreground/30 bg-muted text-muted-foreground" },
}

function ProductSupplierCoverage({ product, active }: { product: ProductItem; active: boolean }) {
  const sku = product.sku || ""
  const [coverage, setCoverage] = useState<SupplierCoverageResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [reviewing, setReviewing] = useState("")

  useEffect(() => { setCoverage(null) }, [sku])
  useEffect(() => {
    if (!active || !sku || coverage) return
    let cancelled = false
    setLoading(true)
    api<SupplierCoverageResponse>(`/api/inventory/${encodeURIComponent(sku)}/suppliers`)
      .then((result) => { if (!cancelled) setCoverage(result) })
      .catch((error) => { if (!cancelled) toast.error(error instanceof Error ? error.message : "Unable to load supplier coverage.") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [active, coverage, sku])

  const matches = coverage?.matches || []
  const potentialMatches = matches.filter((match) => match.matchStatus === "pending")
  const primaryMatch = supplierMatchPresentation[coverage?.matchType || "none"] || supplierMatchPresentation.none
  const reviewMatch = async (match: SupplierCoverageEntry, status: "approved" | "rejected") => {
    if (!match.reviewId) return
    setReviewing(match.reviewId)
    try {
      await api(`/api/inventory/${encodeURIComponent(sku)}/supplier-matches/${encodeURIComponent(match.reviewId)}/review`, { method: "POST", body: JSON.stringify({ status }) })
      toast.success(status === "approved" ? "Supplier match approved." : "Supplier match rejected.")
      setCoverage(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to review supplier match.")
    } finally {
      setReviewing("")
    }
  }
  return <div className="grid gap-4">
    <Alert><Boxes className="size-4" /><AlertTitle>Supplier coverage</AlertTitle><AlertDescription>DataPlus confirms supplier records by UPC or an exact vendor/source SKU. Exact manufacturer part numbers are shown as potential matches for review; brand does not include or exclude a supplier.</AlertDescription></Alert>
    {loading && <div className="grid gap-2"><Skeleton className="h-14" /><Skeleton className="h-14" /></div>}
    {!loading && <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 p-3 text-sm"><div><p className="font-medium">{numberLabel(coverage?.supplierCount || 0)} confirmed supplier{Number(coverage?.supplierCount || 0) === 1 ? "" : "s"}{potentialMatches.length ? ` · ${potentialMatches.length} potential` : ""}</p><p className="text-xs text-muted-foreground">UPC: {product.barcode || "Not recorded"} · MPN: {product.mfrPartNumber || "Not recorded"}</p></div><Badge variant="outline" className={primaryMatch.className}>{primaryMatch.label}</Badge></div>}
    {!loading && matches.length > 0 && <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Supplier</TableHead><TableHead>Vendor SKU</TableHead><TableHead>MPN</TableHead><TableHead>UPC</TableHead><TableHead>Match basis</TableHead><TableHead>Stock</TableHead><TableHead>Cost</TableHead><TableHead>UOM</TableHead><TableHead>Status</TableHead><TableHead>Review</TableHead></TableRow></TableHeader><TableBody>{matches.map((match, index) => { const presentation = supplierMatchPresentation[match.matchType || "none"] || supplierMatchPresentation.none; const pending = match.matchStatus === "pending"; return <TableRow key={`${match.supplier}-${match.sourceSku || match.sku || match.vendorSku}-${index}`} className={pending ? "bg-amber-500/5" : ""}><TableCell className="font-medium">{match.supplier || "Unknown supplier"}</TableCell><TableCell className="font-mono text-xs">{match.vendorSku || match.sourceSku || match.sku || "-"}</TableCell><TableCell className="font-mono text-xs">{match.mfrPartNumber || "-"}</TableCell><TableCell className="font-mono text-xs">{match.barcode || "-"}</TableCell><TableCell><Badge variant="outline" className={presentation.className}>{presentation.label}</Badge></TableCell><TableCell>{numberLabel(match.stockQty ?? match.qty)}</TableCell><TableCell>{moneyLabel(match.cost)}</TableCell><TableCell>{match.uomQty ? `${match.uomQty} ${match.uom || ""}`.trim() : match.uom || "-"}</TableCell><TableCell>{match.discontinued ? <Badge variant="destructive">Discontinued</Badge> : <Badge variant="outline">{match.stockStatus || "Active"}</Badge>}</TableCell><TableCell>{pending && match.reviewId ? <div className="flex items-center gap-1"><Button size="icon-sm" variant="outline" title="Approve supplier match" disabled={reviewing === match.reviewId} onClick={() => reviewMatch(match, "approved")}><CheckCircle2 /></Button><Button size="icon-sm" variant="outline" title="Reject supplier match" disabled={reviewing === match.reviewId} onClick={() => reviewMatch(match, "rejected")}><X /></Button></div> : <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">{match.matchStatus === "approved" ? "Approved" : "Confirmed"}</Badge>}</TableCell></TableRow> })}</TableBody></Table></div>}
    {!loading && coverage && matches.length === 0 && <p className="rounded-md border border-dashed p-5 text-sm text-muted-foreground">No supplier source record matches this product identity yet.</p>}
  </div>
}
type MainCategoryOption = { id?: string; name?: string; mappings?: { shopify?: { categoryPath?: string; status?: string } | null } }

function MainCategoryPicker({ value, onValueChange, suggestedCategory = "", disabled = false }: { value: string; onValueChange: (value: string) => void; suggestedCategory?: string; disabled?: boolean }) {
  const [options, setOptions] = useState<MainCategoryOption[]>([])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)

  const handleOpenChange = (nextOpen: boolean) => {
    if (disabled) return
    setOpen(nextOpen)
    if (nextOpen) setQuery(value)
  }

  useEffect(() => {
    if (!open) return
    const search = query.trim()
    if (search.length < 2) {
      setOptions([])
      setLoading(false)
      return
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      setLoading(true)
      api<{ categories?: MainCategoryOption[] }>(`/api/categories?scope=main&q=${encodeURIComponent(search)}`, { signal: controller.signal })
        .then((result) => setOptions((result.categories || []).slice(0, 40)))
        .catch(() => { if (!controller.signal.aborted) setOptions([]) })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 150)
    return () => { controller.abort(); window.clearTimeout(timeout) }
  }, [open, query])

  const createAndSelect = async (requestedName: string) => {
    const name = requestedName.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      const result = await api<{ category?: MainCategoryOption; created?: boolean }>("/api/categories", {
        method: "POST",
        body: JSON.stringify({ name, scope: "main" })
      })
      const categoryName = String(result.category?.name || name)
      setOptions((current) => [result.category || { name: categoryName }, ...current.filter((option) => String(option.name || "").toLowerCase() !== categoryName.toLowerCase())])
      onValueChange(categoryName)
      setQuery(categoryName)
      setOpen(false)
      toast.success(result.created ? `Created and assigned ${categoryName}.` : `Assigned ${categoryName}.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create the category.")
    } finally {
      setCreating(false)
    }
  }

  const selected = options.find((option) => String(option.name || "").toLowerCase() === value.trim().toLowerCase())
  const exactQueryMatch = options.some((option) => String(option.name || "").toLowerCase() === query.trim().toLowerCase())
  const shopifyMapping = selected?.mappings?.shopify
  return <div className="grid gap-1.5 rounded-lg border border-slate-200 bg-slate-50/85 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:border-neutral-800 dark:bg-neutral-900/45 dark:shadow-none">
    <Label>Main category</Label>
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} className="h-auto min-h-10 w-full justify-between gap-3 bg-white px-3 py-2 text-left font-normal shadow-sm dark:bg-background">
          <span className={value ? "min-w-0 whitespace-normal break-words" : "text-muted-foreground"}>{value || "Select approved main category"}</span>
          <Search className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(560px,calc(100vw-2rem))] p-0">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search full category path..." />
          <CommandList className="max-h-72">
            {query.trim().length < 2 && <CommandEmpty>Type at least 2 characters to search.</CommandEmpty>}
            {query.trim().length >= 2 && loading && <CommandEmpty>Searching approved main categories...</CommandEmpty>}
            {query.trim().length >= 2 && !loading && !options.length && <CommandEmpty>No existing main category matches.</CommandEmpty>}
            {options.length > 0 && <CommandGroup heading="Approved main categories">
              {options.map((option) => {
                const name = String(option.name || "")
                return <CommandItem key={option.id || name} value={name} onSelect={() => { onValueChange(name); setQuery(name); setOpen(false) }} className="items-start py-2">
                  <div className="min-w-0">
                    <div className="whitespace-normal break-words text-sm">{name}</div>
                    <div className="mt-0.5 whitespace-normal break-words text-xs text-muted-foreground">Shopify: {option.mappings?.shopify?.categoryPath || "Not mapped"}</div>
                  </div>
                </CommandItem>
              })}
            </CommandGroup>}
            {query.trim().length >= 2 && !loading && !exactQueryMatch && <><CommandSeparator /><CommandGroup heading="Category actions"><CommandItem disabled={creating} value={`create-${query}`} onSelect={() => void createAndSelect(query)}><Plus className="size-4" />{creating ? "Creating category..." : `Create category: ${query.trim()}`}</CommandItem></CommandGroup></>}
            {value && <><CommandSeparator /><CommandGroup><CommandItem value="clear-main-category" onSelect={() => { onValueChange(""); setQuery(""); setOpen(false) }}>Clear main category</CommandItem></CommandGroup></>}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    {!value && suggestedCategory.trim() ? <div className="flex items-start justify-between gap-3 rounded-md border border-blue-500/20 bg-blue-50/70 p-2.5 dark:border-blue-400/20 dark:bg-blue-950/20">
      <div className="min-w-0"><p className="text-xs font-medium text-blue-950 dark:text-blue-100">Suggested vendor category</p><p className="mt-0.5 break-words text-xs text-blue-800 dark:text-blue-200">{suggestedCategory.trim()}</p></div>
      <Button type="button" size="sm" variant="outline" disabled={creating} onClick={() => void createAndSelect(suggestedCategory)}>{creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />} Use</Button>
    </div> : null}
    {selected && <p className="text-xs text-muted-foreground">Shopify: {shopifyMapping?.categoryPath ? shopifyMapping.categoryPath : "No Shopify mapping yet"}</p>}
    {value ? <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" asChild>
        <a href={categoryProfileUrl(value)}>
          <ExternalLink className="size-3.5" />
          Open category page
        </a>
      </Button>
      <Button type="button" size="sm" variant="ghost" asChild>
        <a href={categoryProductsUrl(value)} target="_blank" rel="noreferrer">
          View SKUs
        </a>
      </Button>
    </div> : null}
    {!selected && value && <p className="text-xs text-amber-600 dark:text-amber-300">Choose an approved path from the category index to save this main category.</p>}
  </div>
}

function categoryProfileUrl(category: string) {
  return `/categories/${encodeURIComponent(category)}`
}

function categoryProductsUrl(category: string) {
  return `/products?category=${encodeURIComponent(category)}`
}

function openInAppPath(path: string) {
  window.history.pushState({}, "", path)
  window.dispatchEvent(new PopStateEvent("popstate"))
}

function ProductCategoryPopover({ category, sourceCategory, compact = false }: { category: string; sourceCategory?: string; compact?: boolean }) {
  const categoryText = category.trim()
  if (!categoryText) return <p className={compact ? "text-sm text-muted-foreground" : "mt-4 max-w-4xl text-sm text-muted-foreground"}>Uncategorized</p>
  return <Popover>
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" className={cn(compact ? "mt-1 w-full" : "mt-4 max-w-4xl", "h-auto justify-start gap-2 rounded-full border-blue-500/25 bg-blue-500/10 px-3 py-2 text-left text-sm font-medium text-blue-700 shadow-none hover:bg-blue-500/15 dark:text-blue-300")}>
        <PackageSearch className="size-4 shrink-0" />
        <span className="min-w-0 whitespace-normal break-words">{categoryText}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-[min(460px,calc(100vw-2rem))]">
      <div className="grid gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Main category</p>
          <p className="mt-1 text-sm font-semibold leading-5">{categoryText}</p>
          {sourceCategory ? <p className="mt-2 text-xs text-muted-foreground">Vendor category: {sourceCategory}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => openInAppPath(categoryProfileUrl(categoryText))}>
            Open category
            <ArrowRight className="size-4" />
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={categoryProductsUrl(categoryText)} target="_blank" rel="noreferrer">
              View SKUs
              <ExternalLink className="size-4" />
            </a>
          </Button>
        </div>
      </div>
    </PopoverContent>
  </Popover>
}

function ProductEditorDialog({ open, onOpenChange, initialTab, draft, setDraft, saving, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; initialTab: "basics" | "content" | "pricing" | "shipping" | "audit"; draft: Record<string, string | boolean>; setDraft: React.Dispatch<React.SetStateAction<Record<string, string | boolean>>>; saving: boolean; onSave: () => void }) {
  const [editorTab, setEditorTab] = useState(initialTab)
  useEffect(() => { if (open) setEditorTab(initialTab) }, [open, initialTab])
  const set = (key: string, value: string | boolean) => setDraft((current) => ({ ...current, [key]: value }))
  const editFieldClass = "grid gap-1.5 rounded-lg border border-slate-200 bg-slate-50/85 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:border-neutral-800 dark:bg-neutral-900/45 dark:shadow-none"
  const editInputClass = "bg-white shadow-sm dark:bg-background"
  const input = (label: string, key: string, type = "text") => <div className={editFieldClass}><Label>{label}</Label><Input className={editInputClass} type={type} value={String(draft[key] ?? "")} onChange={(event) => set(key, event.target.value)} /></div>
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="flex max-h-[92vh] min-h-[620px] flex-col overflow-hidden sm:max-w-5xl"><DialogHeader><DialogTitle>Edit product</DialogTitle><DialogDescription>Update the catalog record in focused sections. Channel-specific values remain in their channel tabs.</DialogDescription></DialogHeader><Tabs value={editorTab} onValueChange={(value) => setEditorTab(value as typeof editorTab)} className="flex min-h-0 flex-1 flex-col"><div className="overflow-x-auto border-y bg-muted/20 px-1"><TabsList className="h-auto min-w-max bg-transparent p-1"><TabsTrigger value="basics">Basics</TabsTrigger><TabsTrigger value="content">Content</TabsTrigger><TabsTrigger value="pricing">Pricing & inventory</TabsTrigger><TabsTrigger value="shipping">Shipping</TabsTrigger><TabsTrigger value="media">Media</TabsTrigger><TabsTrigger value="audit">Audit fields</TabsTrigger></TabsList></div><div className="min-h-0 flex-1 overflow-y-auto py-5 pr-2"><TabsContent value="basics" className="m-0 grid gap-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{input("Product title", "marketplaceTitle")}{input("Brand", "brand")}{input("Manufacturer", "manufacturer")}{input("Manufacturer part number", "mfrPartNumber")}{input("Supplier", "supplier")}{input("Supplier code", "supplierCode")}{input("Vendor SKU", "vendorSku")}<MainCategoryPicker value={String(draft.mainCategory ?? "")} suggestedCategory={String(draft.vendorCategory || draft.sourceCategory || "")} onValueChange={(value) => set("mainCategory", value)} />{input("Source category", "sourceCategory")}{input("Vendor category", "vendorCategory")}{input("Condition", "condition")}{input("Status", "status")}</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{input("UPC / barcode", "barcode")}{input("External ID", "externalId")}{input("UNSPSC", "unspsc")}{input("UOM", "uom")}{input("UOM quantity", "uomQty", "number")}{input("Tags (comma separated)", "tags")}</div><div className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50/85 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] sm:grid-cols-2 dark:border-neutral-800 dark:bg-neutral-900/45 dark:shadow-none"><ToggleRow label="Product active" description="Controls whether the catalog record is active." checked={Boolean(draft.active)} disabled={false} onCheckedChange={(checked) => set("active", checked)} /><ToggleRow label="Category verified" description="Set automatically when an approved main category is saved." checked={Boolean(draft.categoryVerified)} disabled={true} onCheckedChange={() => undefined} /></div></TabsContent><TabsContent value="content" className="m-0 grid gap-5"><div className={editFieldClass}><Label>Short description</Label><Textarea className={editInputClass} rows={4} value={String(draft.shortDescription ?? "")} onChange={(event) => set("shortDescription", event.target.value)} /></div><div className={editFieldClass}><Label>Long description</Label><Textarea className={editInputClass} rows={10} value={String(draft.longDescription ?? "")} onChange={(event) => set("longDescription", event.target.value)} /></div><div className={editFieldClass}><Label>Bullet points (one per line)</Label><Textarea className={editInputClass} rows={6} value={String(draft.bulletPoints ?? "")} onChange={(event) => set("bulletPoints", event.target.value)} /></div><div className="grid gap-3 sm:grid-cols-2">{input("SEO keywords", "seoKeywords")}{input("Wildcard search", "wildcardSearch")}</div></TabsContent><TabsContent value="pricing" className="m-0 grid gap-5"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{input("Website price", "websitePrice", "number")}{input("Source cost", "cost", "number")}{input("FOB price", "fobPrice", "number")}{input("List / MSRP", "listPrice", "number")}</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{input("On-hand quantity", "qty", "number")}{input("Reserved quantity", "reserved", "number")}{input("Reorder point", "reorderPoint", "number")}{input("Minimum quantity", "minQuantity", "number")}{input("Quantity increments", "quantityIncrements", "number")}{input("Lead time", "leadTime", "number")}</div><p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">Vendor and channel pricing rules still determine calculated channel prices. Manual values here update the catalog inputs used by those rules.</p></TabsContent><TabsContent value="shipping" className="m-0 grid gap-5"><div className="grid gap-3 sm:grid-cols-2"><Field label="Shipping classification override"><Select value={String(draft.shippingClassOverride === "oversize_parcel" ? "auto" : draft.shippingClassOverride || "auto")} onValueChange={(value) => set("shippingClassOverride", value === "auto" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="auto">Automatic classification</SelectItem><SelectItem value="parcel">FedEx Ground (limits checked)</SelectItem><SelectItem value="ltl">LTL</SelectItem></SelectContent></Select></Field>{input("Override reason", "shippingOverrideReason")}</div><div className="grid gap-3 rounded-lg border border-blue-500/20 bg-blue-50/70 p-3 dark:border-blue-400/20 dark:bg-blue-950/20"><div><p className="text-sm font-medium">Default shipping dimensions</p><p className="text-xs text-muted-foreground">Rates prefer these individual product measurements. Package values fill any missing measurements unless the override is enabled.</p></div><div className="grid gap-3 sm:grid-cols-4">{input("Length (in)", "itemLength", "number")}{input("Width (in)", "itemWidth", "number")}{input("Height (in)", "itemHeight", "number")}{input("Weight (lb)", "itemWeight", "number")}</div></div><div className="grid gap-3 rounded-lg border border-emerald-500/20 bg-emerald-50/70 p-3 dark:border-emerald-400/20 dark:bg-emerald-950/20"><ToggleRow label="Use package override" description="Always use these package measurements. When off, they fill missing product measurements." checked={Boolean(draft.shippingPackageOverride)} disabled={false} onCheckedChange={(checked) => set("shippingPackageOverride", checked)} /><div className="grid gap-3 sm:grid-cols-4">{input("Package length (in)", "packageLength", "number")}{input("Package width (in)", "packageWidth", "number")}{input("Package height (in)", "packageHeight", "number")}{input("Package weight (lb)", "packageWeight", "number")}</div></div><ToggleRow label="Ship alone" description="Create a separate package and label for this SKU when it is ordered with other products." checked={Boolean(draft.shipAlone)} disabled={false} onCheckedChange={(checked) => set("shipAlone", checked)} /><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{input("Dimensional weight (lb)", "dimensionalWeight", "number")}{input("Country of origin", "countryOfOrigin")}{input("SDS URL", "sdsUrl")}</div><ToggleRow label="Hazardous product" description="Marks this record for shipping and compliance review." checked={Boolean(draft.hazardous)} disabled={false} onCheckedChange={(checked) => set("hazardous", checked)} /></TabsContent><TabsContent value="media" className="m-0 grid gap-5"><div className={editFieldClass}>{input("Default image URL", "defaultImage")}<Label>Image URLs (one per line)</Label><Textarea className={editInputClass} rows={10} value={String(draft.images ?? "")} onChange={(event) => set("images", event.target.value)} placeholder="https://..." /></div></TabsContent><TabsContent value="audit" className="m-0 grid gap-5"><p className="text-sm text-muted-foreground">These fields preserve the latest supplier feed and price audit details when they need correction.</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{input("Stock status", "stockStatus")}{input("Stock updated at", "stockUpdatedAt")}{input("Last price update at", "lastPricesUpdateAt")}{input("Last price updated by", "lastPricesUpdateBy")}</div></TabsContent></div></Tabs><DialogFooter className="border-t pt-4"><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={onSave} disabled={saving || (Boolean(draft.shippingClassOverride) && !String(draft.shippingOverrideReason || "").trim())}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save product</Button></DialogFooter></DialogContent></Dialog>
}

type EbayProductSettingsDraft = Record<string, string | boolean>

function ProductEbaySettingsDialogLegacy({ open, onOpenChange, product, channel, onUpdated }: { open: boolean; onOpenChange: (open: boolean) => void; product: ProductItem; channel: ChannelConnection; onUpdated: (product: ProductItem) => void }) {
  const [draft, setDraft] = useState<EbayProductSettingsDraft>({ useChannelDefaults: true })
  const [saving, setSaving] = useState(false)
  const ebay = product.ebayListing || {}
  const channelSettings = channel.settings || {}
  const overrides = ebay.settings || {}
  const locations = Array.isArray(channelSettings.ebayMerchantLocations) ? channelSettings.ebayMerchantLocations : []
  const paymentPolicies = Array.isArray(channelSettings.ebayPaymentPolicies) ? channelSettings.ebayPaymentPolicies : []
  const returnPolicies = Array.isArray(channelSettings.ebayReturnPolicies) ? channelSettings.ebayReturnPolicies : []
  const fulfillmentPolicies = Array.isArray(channelSettings.ebayFulfillmentPolicies) ? channelSettings.ebayFulfillmentPolicies : []

  useEffect(() => {
    if (!open) return
    const useChannelDefaults = overrides.useChannelDefaults !== false
    const value = (key: string, fallback: unknown = "") => useChannelDefaults ? channelSettings[key] ?? fallback : overrides[key] ?? channelSettings[key] ?? fallback
    const storedSpecifics = overrides.ebayItemSpecifics ?? (Object.keys(ebay.itemSpecifics || {}).length ? JSON.stringify(ebay.itemSpecifics, null, 2) : "")
    setDraft({
      useChannelDefaults,
      ebayMarketplaceId: String(value("ebayMarketplaceId", "EBAY_US")),
      ebayMerchantLocationKey: String(value("ebayMerchantLocationKey", "")),
      ebayPaymentPolicyId: String(value("ebayPaymentPolicyId", "")),
      ebayReturnPolicyId: String(value("ebayReturnPolicyId", "")),
      ebayFulfillmentPolicyId: String(value("ebayFulfillmentPolicyId", "")),
      ebayDefaultCondition: String(value("ebayDefaultCondition", ebay.condition || "NEW")),
      ebayCurrency: String(value("ebayCurrency", ebay.currency || "USD")),
      ebayListingFormat: String(value("ebayListingFormat", "FIXED_PRICE")),
      ebayQuantityMode: String(value("ebayQuantityMode", "available")),
      ebayDescriptionSource: String(value("ebayDescriptionSource", "longDescription")),
      ebayPricingMode: String(value("ebayPricingMode", "cost-plus")),
      ebayRoundingRule: String(value("ebayRoundingRule", "none")),
      ebayMaxImages: String(value("ebayMaxImages", 12)),
      ebayPriceMarkupPercent: String(value("ebayPriceMarkupPercent", 0)),
      ebayMinMarginPercent: String(value("ebayMinMarginPercent", 0)),
      ebayMinimumPrice: String(value("ebayMinimumPrice", 0)),
      ebayManualPrice: String(overrides.ebayManualPrice ?? ""),
      ebayQuantityOverride: String(overrides.ebayQuantityOverride ?? ""),
      ebayAutoPublish: value("ebayAutoPublish", false) === true || String(value("ebayAutoPublish", false)).toLowerCase() === "true",
      ebayRequireImage: value("ebayRequireImage", true) !== false && String(value("ebayRequireImage", true)).toLowerCase() !== "false",
      ebayBestOfferEnabled: value("ebayBestOfferEnabled", false) === true || String(value("ebayBestOfferEnabled", false)).toLowerCase() === "true",
      ebayCategoryId: String(overrides.ebayCategoryId ?? ebay.localCategoryId ?? (ebay.sourceOfTruth === "ebay_catalog_sync" ? "" : ebay.categoryId) ?? ""),
      ebayCategoryPath: String(overrides.ebayCategoryPath ?? ebay.localCategoryPath ?? (ebay.sourceOfTruth === "ebay_catalog_sync" ? "" : ebay.categoryPath) ?? ""),
      ebayTaxonomyVersion: String(overrides.ebayTaxonomyVersion ?? ebay.taxonomyVersion ?? ""),
      ebayItemSpecifics: String(storedSpecifics || ""),
    })
  }, [open, product, channel, ebay, overrides, channelSettings])

  const useChannelDefaults = draft.useChannelDefaults !== false
  const set = (key: string, value: string | boolean) => setDraft((current) => ({ ...current, [key]: value }))
  const text = (key: string) => String(draft[key] ?? "")
  const input = (label: string, key: string, type = "text", disabled = useChannelDefaults, description = "") => <div className="grid gap-1.5"><Label htmlFor={`ebay-${key}`}>{label}</Label><Input id={`ebay-${key}`} type={type} min={type === "number" ? 0 : undefined} step={type === "number" ? "0.01" : undefined} disabled={disabled} value={text(key)} onChange={(event) => set(key, event.target.value)} />{description ? <p className="text-xs text-muted-foreground">{description}</p> : null}</div>
  const select = (label: string, key: string, options: Array<{ value: string; label: string }>, disabled = useChannelDefaults, description = "") => {
    const selected = text(key)
    const hasSelected = options.some((option) => option.value === selected)
    const available = selected && !hasSelected ? [{ value: selected, label: selected }, ...options] : options
    return <div className="grid gap-1.5"><Label>{label}</Label><Select disabled={disabled} value={selected || "__not_set"} onValueChange={(value) => set(key, value === "__not_set" ? "" : value)}><SelectTrigger><SelectValue placeholder="Not selected" /></SelectTrigger><SelectContent><SelectItem value="__not_set">Not selected</SelectItem>{available.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>{description ? <p className="text-xs text-muted-foreground">{description}</p> : null}</div>
  }
  const toggle = (label: string, description: string, key: string, disabled = useChannelDefaults) => <div className="rounded-md border p-3"><ToggleRow label={label} description={description} checked={draft[key] === true} disabled={disabled} onCheckedChange={(checked) => set(key, checked)} /></div>
  const save = async () => {
    setSaving(true)
    try {
      const ebaySettings = {
        useChannelDefaults,
        ebayMarketplaceId: text("ebayMarketplaceId"),
        ebayMerchantLocationKey: text("ebayMerchantLocationKey"),
        ebayPaymentPolicyId: text("ebayPaymentPolicyId"),
        ebayReturnPolicyId: text("ebayReturnPolicyId"),
        ebayFulfillmentPolicyId: text("ebayFulfillmentPolicyId"),
        ebayDefaultCondition: text("ebayDefaultCondition"),
        ebayCurrency: text("ebayCurrency"),
        ebayListingFormat: text("ebayListingFormat"),
        ebayQuantityMode: text("ebayQuantityMode"),
        ebayDescriptionSource: text("ebayDescriptionSource"),
        ebayPricingMode: text("ebayPricingMode"),
        ebayRoundingRule: text("ebayRoundingRule"),
        ebayMaxImages: text("ebayMaxImages"),
        ebayPriceMarkupPercent: text("ebayPriceMarkupPercent"),
        ebayMinMarginPercent: text("ebayMinMarginPercent"),
        ebayMinimumPrice: text("ebayMinimumPrice"),
        ebayManualPrice: text("ebayManualPrice"),
        ebayQuantityOverride: text("ebayQuantityOverride"),
        ebayAutoPublish: draft.ebayAutoPublish === true,
        ebayRequireImage: draft.ebayRequireImage === true,
        ebayBestOfferEnabled: draft.ebayBestOfferEnabled === true,
        ebayCategoryId: text("ebayCategoryId"),
        ebayCategoryPath: text("ebayCategoryPath"),
        ebayTaxonomyVersion: text("ebayTaxonomyVersion"),
        ebayItemSpecifics: text("ebayItemSpecifics"),
      }
      const result = await api<{ item: ProductItem }>(`/api/inventory/${encodeURIComponent(product.id || product.sku || "")}/ebay/listing`, {
        method: "POST",
        body: JSON.stringify({
          action: "draft",
          ebaySettings,
          categoryId: ebaySettings.ebayCategoryId,
          categoryPath: ebaySettings.ebayCategoryPath,
          taxonomyVersion: ebaySettings.ebayTaxonomyVersion,
          itemSpecifics: ebaySettings.ebayItemSpecifics,
        }),
      })
      onUpdated(result.item)
      onOpenChange(false)
      toast.success(useChannelDefaults ? "eBay channel defaults are now linked to this SKU." : "eBay SKU override saved.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save eBay SKU settings.")
    } finally {
      setSaving(false)
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="flex h-[min(92vh,940px)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0 sm:max-w-6xl"><DialogHeader className="border-b px-6 py-5"><div className="flex flex-wrap items-center justify-between gap-3 pr-8"><div><DialogTitle>eBay listing settings</DialogTitle><DialogDescription className="mt-1">Configure eBay behavior for <span className="font-mono">{product.sku}</span>. Saving this stores configuration only; it does not create or publish an eBay listing.</DialogDescription></div><Badge variant={useChannelDefaults ? "outline" : "default"}>{useChannelDefaults ? "Using channel defaults" : "SKU override"}</Badge></div></DialogHeader><Tabs defaultValue="inheritance" className="flex min-h-0 flex-1 flex-col"><div className="overflow-x-auto border-b bg-muted/20 px-4"><TabsList className="h-auto min-w-max bg-transparent p-1"><TabsTrigger value="inheritance">Inheritance</TabsTrigger><TabsTrigger value="commercial">Commercial</TabsTrigger><TabsTrigger value="policies">Policies & fulfillment</TabsTrigger><TabsTrigger value="category">Category & specifics</TabsTrigger></TabsList></div><div className="min-h-0 flex-1 overflow-y-auto px-6 py-5"><TabsContent value="inheritance" className="m-0 grid gap-5"><Alert><Settings className="size-4" /><AlertTitle>{useChannelDefaults ? "This SKU follows the eBay channel defaults" : "This SKU has its own eBay override"}</AlertTitle><AlertDescription>Channel defaults stay centralized in Channels &gt; eBay &gt; Rules. Turn off inheritance only when this SKU needs different policies, fulfillment, price logic, or publishing behavior. Category and item specifics remain SKU-specific either way.</AlertDescription></Alert><div className="rounded-lg border bg-muted/20 p-4"><ToggleRow label="Use eBay channel defaults" description="When enabled, future changes to eBay channel rules automatically apply to this SKU." checked={useChannelDefaults} disabled={false} onCheckedChange={(checked) => set("useChannelDefaults", checked)} /></div><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{input("Marketplace", "ebayMarketplaceId")}{select("Condition", "ebayDefaultCondition", [{ value: "NEW", label: "New" }, { value: "LIKE_NEW", label: "Like new" }, { value: "NEW_WITH_DEFECTS", label: "New with defects" }, { value: "USED_EXCELLENT", label: "Used - excellent" }, { value: "USED_VERY_GOOD", label: "Used - very good" }, { value: "USED_GOOD", label: "Used - good" }, { value: "USED_ACCEPTABLE", label: "Used - acceptable" }, { value: "FOR_PARTS_OR_NOT_WORKING", label: "For parts or not working" }])}{input("Currency", "ebayCurrency")}</div></TabsContent><TabsContent value="commercial" className="m-0 grid gap-5"><div className={useChannelDefaults ? "grid gap-5 opacity-75" : "grid gap-5"}><div><h3 className="text-sm font-semibold">Pricing</h3><p className="mt-1 text-sm text-muted-foreground">These controls calculate the offer price from the SKU's sell-unit cost and product price.</p></div><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">{select("Price rule", "ebayPricingMode", [{ value: "cost-plus", label: "Cost plus markup" }, { value: "product-price", label: "Use product price" }, { value: "higher-of-product-or-cost", label: "Higher of product or cost" }])}{input("Markup percent", "ebayPriceMarkupPercent", "number")}{input("Minimum margin percent", "ebayMinMarginPercent", "number")}{input("Minimum price", "ebayMinimumPrice", "number")}{input("Manual price override", "ebayManualPrice", "number", useChannelDefaults, "Optional. When set, this SKU uses this price instead of the formula.")}{select("Rounding", "ebayRoundingRule", [{ value: "none", label: "Nearest cent" }, { value: "nearest .99", label: "Nearest .99" }, { value: "nearest .95", label: "Nearest .95" }, { value: "round up", label: "Round up" }])}</div><Separator /><div><h3 className="text-sm font-semibold">Listing inventory and content</h3><p className="mt-1 text-sm text-muted-foreground">Choose the inventory source and the description DataPlus sends to eBay.</p></div><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">{select("Quantity source", "ebayQuantityMode", [{ value: "available", label: "Available inventory" }, { value: "qty", label: "On-hand quantity" }, { value: "stockQty", label: "Supplier stock quantity" }])}{input("Quantity override", "ebayQuantityOverride", "number", useChannelDefaults, "Optional fixed eBay quantity for this SKU.")}{select("Description source", "ebayDescriptionSource", [{ value: "longDescription", label: "Long description" }, { value: "shortDescription", label: "Short description" }, { value: "title", label: "Product title" }])}{input("Maximum images", "ebayMaxImages", "number")}</div><div className="grid gap-3 md:grid-cols-3">{toggle("Auto publish", "Allows scheduled eBay workflows to publish eligible offers.", "ebayAutoPublish")}{toggle("Require an image", "Block listing readiness when the SKU has no product image.", "ebayRequireImage")}{toggle("Best offer", "Enable eBay best-offer terms for this SKU.", "ebayBestOfferEnabled")}</div></div></TabsContent><TabsContent value="policies" className="m-0 grid gap-5"><div className={useChannelDefaults ? "grid gap-5 opacity-75" : "grid gap-5"}><Alert><Truck className="size-4" /><AlertTitle>Seller policy bundle</AlertTitle><AlertDescription>These seller-account policies are imported from eBay in the channel settings. The selected set is sent with each offer.</AlertDescription></Alert><div className="grid gap-4 md:grid-cols-2">{select("Merchant location", "ebayMerchantLocationKey", locations.map((location) => ({ value: String(location.merchantLocationKey || ""), label: `${location.name || location.merchantLocationKey || "Location"}${location.status ? ` - ${location.status}` : ""}` })).filter((option) => option.value))}{select("Payment policy", "ebayPaymentPolicyId", paymentPolicies.map((policy) => ({ value: String(policy.id || ""), label: `${policy.name || policy.id || "Policy"}${policy.description ? ` - ${policy.description}` : ""}` })).filter((option) => option.value))}{select("Return policy", "ebayReturnPolicyId", returnPolicies.map((policy) => ({ value: String(policy.id || ""), label: `${policy.name || policy.id || "Policy"}${policy.description ? ` - ${policy.description}` : ""}` })).filter((option) => option.value))}{select("Fulfillment policy", "ebayFulfillmentPolicyId", fulfillmentPolicies.map((policy) => ({ value: String(policy.id || ""), label: `${policy.name || policy.id || "Policy"}${policy.description ? ` - ${policy.description}` : ""}` })).filter((option) => option.value))}{select("Listing format", "ebayListingFormat", [{ value: "FIXED_PRICE", label: "Fixed price" }])}</div></div></TabsContent><TabsContent value="category" className="m-0 grid gap-5"><Alert><Database className="size-4" /><AlertTitle>SKU-specific eBay category</AlertTitle><AlertDescription>These mapping values remain specific to this SKU. They are used in addition to the master category mapping and can be changed whenever eBay's taxonomy needs a correction.</AlertDescription></Alert><div className="grid gap-4 md:grid-cols-2"><div className="md:col-span-2">{input("eBay category ID", "ebayCategoryId", "text", false, "Use the eBay category ID selected for this individual SKU.")}</div>{input("eBay category path", "ebayCategoryPath", "text", false)}{input("Taxonomy version / tree ID", "ebayTaxonomyVersion", "text", false)}</div><div className="grid gap-1.5"><Label htmlFor="ebay-item-specifics">Item specifics (JSON)</Label><Textarea id="ebay-item-specifics" rows={12} value={text("ebayItemSpecifics")} onChange={(event) => set("ebayItemSpecifics", event.target.value)} placeholder={'{\n  "Brand": ["Example"],\n  "MPN": ["12345"]\n}'} /><p className="text-xs text-muted-foreground">DataPlus retains category-required specifics and enriches missing values from catalog data when possible.</p></div></TabsContent></div></Tabs><DialogFooter className="border-t px-6 py-4"><Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save eBay settings</Button></DialogFooter></DialogContent></Dialog>
}

// Keep the previous editor available while existing eBay drafts migrate to the
// dedicated price and inventory controls below.
void ProductEbaySettingsDialogLegacy

function ProductEbaySettingsDialog({ open, onOpenChange, product, channel, onUpdated }: { open: boolean; onOpenChange: (open: boolean) => void; product: ProductItem; channel: ChannelConnection; onUpdated: (product: ProductItem) => void }) {
  const [draft, setDraft] = useState<EbayProductSettingsDraft>({ useChannelDefaults: true, ebayUseChannelDefaultQuantity: true, ebayUseDefaultPricingFormula: true })
  const [saving, setSaving] = useState(false)
  const ebay = product.ebayListing || {}
  const channelSettings = channel.settings || {}
  const overrides = ebay.settings || {}
  const locations = Array.isArray(channelSettings.ebayMerchantLocations) ? channelSettings.ebayMerchantLocations : []
  const paymentPolicies = Array.isArray(channelSettings.ebayPaymentPolicies) ? channelSettings.ebayPaymentPolicies : []
  const returnPolicies = Array.isArray(channelSettings.ebayReturnPolicies) ? channelSettings.ebayReturnPolicies : []
  const fulfillmentPolicies = Array.isArray(channelSettings.ebayFulfillmentPolicies) ? channelSettings.ebayFulfillmentPolicies : []

  useEffect(() => {
    if (!open) return
    const useChannelDefaults = overrides.useChannelDefaults !== false
    const inherited = (key: string, fallback: unknown = "") => useChannelDefaults ? channelSettings[key] ?? fallback : overrides[key] ?? channelSettings[key] ?? fallback
    const storedSpecifics = overrides.ebayItemSpecifics ?? (Object.keys(ebay.itemSpecifics || {}).length ? JSON.stringify(ebay.itemSpecifics, null, 2) : "")
    setDraft({
      useChannelDefaults,
      ebayUseChannelDefaultQuantity: overrides.ebayUseChannelDefaultQuantity !== false,
      ebayUseDefaultPricingFormula: overrides.ebayUseDefaultPricingFormula !== false,
      ebayMarketplaceId: String(inherited("ebayMarketplaceId", "EBAY_US")),
      ebayMerchantLocationKey: String(inherited("ebayMerchantLocationKey", "")),
      ebayPaymentPolicyId: String(inherited("ebayPaymentPolicyId", "")),
      ebayReturnPolicyId: String(inherited("ebayReturnPolicyId", "")),
      ebayFulfillmentPolicyId: String(inherited("ebayFulfillmentPolicyId", "")),
      ebayDefaultCondition: String(inherited("ebayDefaultCondition", ebay.condition || "NEW")),
      ebayCurrency: String(inherited("ebayCurrency", ebay.currency || "USD")),
      ebayListingFormat: String(inherited("ebayListingFormat", "FIXED_PRICE")),
      ebayQuantityMode: String(inherited("ebayQuantityMode", "available")),
      ebayDescriptionSource: String(inherited("ebayDescriptionSource", "longDescription")),
      ebayPricingMode: String(inherited("ebayPricingMode", "cost-plus")),
      ebayRoundingRule: String(inherited("ebayRoundingRule", "none")),
      ebayMaxImages: String(inherited("ebayMaxImages", 12)),
      ebayPriceMarkupPercent: String(inherited("ebayPriceMarkupPercent", 0)),
      ebayMinMarginPercent: String(inherited("ebayMinMarginPercent", 0)),
      ebayMinimumPrice: String(inherited("ebayMinimumPrice", 0)),
      ebayPromotedListingsEnabled: inherited("ebayPromotedListingsEnabled", false) === true || String(inherited("ebayPromotedListingsEnabled", false)).toLowerCase() === "true",
      ebayPromotedListingsRatePercent: String(inherited("ebayPromotedListingsRatePercent", 2)),
      ebayPrice: String(overrides.ebayPrice ?? overrides.ebayManualPrice ?? ""),
      ebayAutoPublish: inherited("ebayAutoPublish", false) === true || String(inherited("ebayAutoPublish", false)).toLowerCase() === "true",
      ebayRequireImage: inherited("ebayRequireImage", true) !== false && String(inherited("ebayRequireImage", true)).toLowerCase() !== "false",
      ebayBestOfferEnabled: inherited("ebayBestOfferEnabled", false) === true || String(inherited("ebayBestOfferEnabled", false)).toLowerCase() === "true",
      ebayCategoryId: String(overrides.ebayCategoryId ?? ebay.localCategoryId ?? (ebay.sourceOfTruth === "ebay_catalog_sync" ? "" : ebay.categoryId) ?? ""),
      ebayCategoryPath: String(overrides.ebayCategoryPath ?? ebay.localCategoryPath ?? (ebay.sourceOfTruth === "ebay_catalog_sync" ? "" : ebay.categoryPath) ?? ""),
      ebayTaxonomyVersion: String(overrides.ebayTaxonomyVersion ?? ebay.taxonomyVersion ?? ""),
      ebayItemSpecifics: String(storedSpecifics || ""),
    })
  }, [open, product, channel, ebay, overrides, channelSettings])

  const useChannelDefaults = draft.useChannelDefaults !== false
  const useDefaultPricingFormula = draft.ebayUseDefaultPricingFormula !== false
  const useChannelDefaultQuantity = draft.ebayUseChannelDefaultQuantity !== false
  const sellUnitCost = Number(product.sellUnitCost ?? product.cost ?? 0)
  const ebayPrice = Number(String(draft.ebayPrice || "").trim() || 0)
  const ebayAdRatePercent = draft.ebayPromotedListingsEnabled === true ? Math.max(2, Number(draft.ebayPromotedListingsRatePercent || 2)) : 0
  const ebayAdCost = Math.round(ebayPrice * ebayAdRatePercent) / 100
  const ebayProfit = ebayPrice - sellUnitCost - ebayAdCost
  const ebayMargin = ebayPrice > 0 ? (ebayProfit / ebayPrice) * 100 : 0
  const availableInventory = Math.max(0, Math.floor(Number(product.qty ?? product.stockQty ?? 0)) - Math.max(0, Math.floor(Number(product.reserved || 0))))
  const set = (key: string, value: string | boolean) => setDraft((current) => ({ ...current, [key]: value }))
  const text = (key: string) => String(draft[key] ?? "")
  const input = (label: string, key: string, type = "text", disabled = false, description = "") => <div className="grid gap-1.5"><Label htmlFor={`ebay-sku-${key}`}>{label}</Label><Input id={`ebay-sku-${key}`} type={type} min={type === "number" ? 0 : undefined} step={type === "number" ? "0.01" : undefined} disabled={disabled} value={text(key)} onChange={(event) => set(key, event.target.value)} />{description ? <p className="text-xs text-muted-foreground">{description}</p> : null}</div>
  const select = (label: string, key: string, options: Array<{ value: string; label: string }>, disabled = false, description = "") => {
    const selected = text(key)
    const availableOptions = selected && !options.some((option) => option.value === selected) ? [{ value: selected, label: selected }, ...options] : options
    return <div className="grid gap-1.5"><Label>{label}</Label><Select disabled={disabled} value={selected || "__not_set"} onValueChange={(value) => set(key, value === "__not_set" ? "" : value)}><SelectTrigger><SelectValue placeholder="Not selected" /></SelectTrigger><SelectContent><SelectItem value="__not_set">Not selected</SelectItem>{availableOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select>{description ? <p className="text-xs text-muted-foreground">{description}</p> : null}</div>
  }
  const toggle = (label: string, description: string, key: string, disabled = false) => <div className="rounded-md border p-3"><ToggleRow label={label} description={description} checked={draft[key] === true} disabled={disabled} onCheckedChange={(checked) => set(key, checked)} /></div>
  const save = async () => {
    setSaving(true)
    try {
      const ebaySettings = {
        useChannelDefaults,
        ebayUseChannelDefaultQuantity: useChannelDefaultQuantity,
        ebayUseDefaultPricingFormula: useDefaultPricingFormula,
        ebayMarketplaceId: text("ebayMarketplaceId"),
        ebayMerchantLocationKey: text("ebayMerchantLocationKey"),
        ebayPaymentPolicyId: text("ebayPaymentPolicyId"),
        ebayReturnPolicyId: text("ebayReturnPolicyId"),
        ebayFulfillmentPolicyId: text("ebayFulfillmentPolicyId"),
        ebayDefaultCondition: text("ebayDefaultCondition"),
        ebayCurrency: text("ebayCurrency"),
        ebayListingFormat: text("ebayListingFormat"),
        ebayQuantityMode: text("ebayQuantityMode"),
        ebayDescriptionSource: text("ebayDescriptionSource"),
        ebayPricingMode: text("ebayPricingMode"),
        ebayRoundingRule: text("ebayRoundingRule"),
        ebayMaxImages: text("ebayMaxImages"),
        ebayPriceMarkupPercent: text("ebayPriceMarkupPercent"),
        ebayMinMarginPercent: text("ebayMinMarginPercent"),
        ebayMinimumPrice: text("ebayMinimumPrice"),
        ebayPrice: text("ebayPrice"),
        ebayManualPrice: text("ebayPrice"),
        ebayAutoPublish: draft.ebayAutoPublish === true,
        ebayRequireImage: draft.ebayRequireImage === true,
        ebayBestOfferEnabled: draft.ebayBestOfferEnabled === true,
        ebayCategoryId: text("ebayCategoryId"),
        ebayCategoryPath: text("ebayCategoryPath"),
        ebayTaxonomyVersion: text("ebayTaxonomyVersion"),
        ebayItemSpecifics: text("ebayItemSpecifics"),
      }
      const result = await api<{ item: ProductItem }>(`/api/inventory/${encodeURIComponent(product.id || product.sku || "")}/ebay/listing`, {
        method: "POST",
        body: JSON.stringify({ action: "draft", ebaySettings, categoryId: ebaySettings.ebayCategoryId, categoryPath: ebaySettings.ebayCategoryPath, taxonomyVersion: ebaySettings.ebayTaxonomyVersion, itemSpecifics: ebaySettings.ebayItemSpecifics }),
      })
      onUpdated(result.item)
      onOpenChange(false)
      toast.success("eBay SKU settings saved.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save eBay SKU settings.")
    } finally {
      setSaving(false)
    }
  }

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="flex h-[min(92vh,940px)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden p-0 sm:max-w-6xl"><DialogHeader className="border-b px-6 py-5"><div className="flex flex-wrap items-center justify-between gap-3 pr-8"><div><DialogTitle>eBay listing settings</DialogTitle><DialogDescription className="mt-1">Set the policies, price, inventory behavior, and category that DataPlus will use for <span className="font-mono">{product.sku}</span>.</DialogDescription></div><div className="flex flex-wrap items-center gap-2">{ebay.listingUrl ? <Button asChild size="sm" variant="outline"><a href={ebay.listingUrl} target="_blank" rel="noreferrer"><ExternalLink className="size-4" /> View on eBay</a></Button> : null}<Badge variant={useChannelDefaults ? "outline" : "default"}>{useChannelDefaults ? "Channel policy defaults" : "SKU policy override"}</Badge></div></div></DialogHeader><Tabs defaultValue="commercial" className="flex min-h-0 flex-1 flex-col"><div className="overflow-x-auto border-b bg-muted/20 px-4"><TabsList className="h-auto min-w-max bg-transparent p-1"><TabsTrigger value="commercial">Pricing & inventory</TabsTrigger><TabsTrigger value="policies">Policies & fulfillment</TabsTrigger><TabsTrigger value="listing">Listing defaults</TabsTrigger><TabsTrigger value="category">Category & specifics</TabsTrigger></TabsList></div><div className="min-h-0 flex-1 overflow-y-auto px-6 py-5"><TabsContent value="commercial" className="m-0 grid gap-5"><section className="grid gap-4 rounded-lg border p-4"><div><h3 className="text-sm font-semibold">eBay pricing</h3><p className="mt-1 text-sm text-muted-foreground">Choose whether this SKU uses the eBay channel formula or a specific eBay selling price.</p></div>{toggle("Use default eBay pricing formula", "When enabled, the eBay channel pricing formula determines the offer price.", "ebayUseDefaultPricingFormula")}{useDefaultPricingFormula ? <Alert><Settings className="size-4" /><AlertTitle>Using the eBay channel formula</AlertTitle><AlertDescription>{`Rule: ${text("ebayPricingMode") || "cost-plus"}; markup ${text("ebayPriceMarkupPercent") || "0"}%; minimum price ${moneyLabel(Number(text("ebayMinimumPrice") || 0))}. Change these defaults in Channels > eBay > Rules.`}</AlertDescription></Alert> : <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"><div>{input("eBay price", "ebayPrice", "number", false, "This fixed SKU price is sent to eBay instead of the channel formula.")}</div><div className="grid gap-3 sm:grid-cols-4"><div className="rounded-md border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">Sell-unit cost</p><p className="mt-1 font-semibold">{moneyLabel(sellUnitCost)}</p></div><div className="rounded-md border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">eBay price</p><p className="mt-1 font-semibold">{moneyLabel(ebayPrice)}</p></div><div className="rounded-md border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">Profit</p><p className={ebayProfit < 0 ? "mt-1 font-semibold text-destructive" : "mt-1 font-semibold text-emerald-700 dark:text-emerald-300"}>{moneyLabel(ebayProfit)}</p></div><div className="rounded-md border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">Margin</p><p className={ebayMargin < 0 ? "mt-1 font-semibold text-destructive" : "mt-1 font-semibold text-emerald-700 dark:text-emerald-300"}>{ebayPrice > 0 ? `${ebayMargin.toFixed(1)}%` : "-"}</p></div></div></div>}</section><section className="grid gap-4 rounded-lg border p-4"><div><h3 className="text-sm font-semibold">eBay inventory</h3><p className="mt-1 text-sm text-muted-foreground">Use the channel rule for this listing or send this SKU's actual available inventory.</p></div>{toggle("Use channel default quantity", "When enabled, the eBay channel's quantity source, safety quantity, and maximum sellable quantity apply.", "ebayUseChannelDefaultQuantity")}{useChannelDefaultQuantity ? <Alert><Database className="size-4" /><AlertTitle>Using the eBay channel quantity rule</AlertTitle><AlertDescription>{`Source: ${text("ebayQuantityMode") || "available"}. Safety and maximum sellable quantities are applied from the eBay channel rules.`}</AlertDescription></Alert> : <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-4"><p className="text-sm font-medium">Actual available inventory will be sent to eBay</p><p className="mt-1 text-sm text-muted-foreground">On hand {numberLabel(product.qty ?? product.stockQty)} minus reserved {numberLabel(product.reserved)} equals <strong className="text-foreground">{numberLabel(availableInventory)} available</strong>. Channel safety and max-sellable limits are not applied.</p></div>}</section><section className="grid gap-4 rounded-lg border p-4"><div><h3 className="text-sm font-semibold">Listing content</h3><p className="mt-1 text-sm text-muted-foreground">These follow the policy defaults until you turn off the policy-default switch.</p></div><div className={useChannelDefaults ? "grid gap-4 opacity-75 md:grid-cols-2 lg:grid-cols-4" : "grid gap-4 md:grid-cols-2 lg:grid-cols-4"}>{select("Description source", "ebayDescriptionSource", [{ value: "longDescription", label: "Long description" }, { value: "shortDescription", label: "Short description" }, { value: "title", label: "Product title" }], useChannelDefaults)}{input("Maximum images", "ebayMaxImages", "number", useChannelDefaults)}{toggle("Auto publish", "Allows scheduled eBay workflows to publish eligible offers.", "ebayAutoPublish", useChannelDefaults)}{toggle("Require an image", "Block listing readiness when the SKU has no product image.", "ebayRequireImage", useChannelDefaults)}{toggle("Best offer", "Enable eBay best-offer terms for this SKU.", "ebayBestOfferEnabled", useChannelDefaults)}</div></section></TabsContent><TabsContent value="policies" className="m-0 grid gap-5"><Alert><Truck className="size-4" /><AlertTitle>Seller policy bundle</AlertTitle><AlertDescription>Policies are imported from eBay. Leave channel policy defaults on for centrally-managed policies, or turn them off for an individual SKU.</AlertDescription></Alert><div className="rounded-lg border bg-muted/20 p-4"><ToggleRow label="Use eBay channel policy defaults" description="Controls marketplace, condition, shipping policy, payment policy, return policy, and fulfillment location. Pricing and inventory keep their own switches." checked={useChannelDefaults} disabled={false} onCheckedChange={(checked) => set("useChannelDefaults", checked)} /></div><div className={useChannelDefaults ? "grid gap-4 opacity-75 md:grid-cols-2" : "grid gap-4 md:grid-cols-2"}>{select("Marketplace", "ebayMarketplaceId", [{ value: "EBAY_US", label: "eBay United States" }], useChannelDefaults)}{select("Condition", "ebayDefaultCondition", [{ value: "NEW", label: "New" }, { value: "LIKE_NEW", label: "Like new" }, { value: "NEW_WITH_DEFECTS", label: "New with defects" }, { value: "USED_EXCELLENT", label: "Used - excellent" }, { value: "USED_VERY_GOOD", label: "Used - very good" }, { value: "USED_GOOD", label: "Used - good" }, { value: "USED_ACCEPTABLE", label: "Used - acceptable" }, { value: "FOR_PARTS_OR_NOT_WORKING", label: "For parts or not working" }], useChannelDefaults)}{select("Merchant location", "ebayMerchantLocationKey", locations.map((location) => ({ value: String(location.merchantLocationKey || ""), label: `${location.name || location.merchantLocationKey || "Location"}${location.status ? ` - ${location.status}` : ""}` })).filter((option) => option.value), useChannelDefaults)}{select("Payment policy", "ebayPaymentPolicyId", paymentPolicies.map((policy) => ({ value: String(policy.id || ""), label: `${policy.name || policy.id || "Policy"}${policy.description ? ` - ${policy.description}` : ""}` })).filter((option) => option.value), useChannelDefaults)}{select("Return policy", "ebayReturnPolicyId", returnPolicies.map((policy) => ({ value: String(policy.id || ""), label: `${policy.name || policy.id || "Policy"}${policy.description ? ` - ${policy.description}` : ""}` })).filter((option) => option.value), useChannelDefaults)}{select("Fulfillment policy", "ebayFulfillmentPolicyId", fulfillmentPolicies.map((policy) => ({ value: String(policy.id || ""), label: `${policy.name || policy.id || "Policy"}${policy.description ? ` - ${policy.description}` : ""}` })).filter((option) => option.value), useChannelDefaults)}{select("Listing format", "ebayListingFormat", [{ value: "FIXED_PRICE", label: "Fixed price" }], useChannelDefaults)}{input("Currency", "ebayCurrency", "text", useChannelDefaults)}</div></TabsContent><TabsContent value="listing" className="m-0 grid gap-5"><Alert><Settings className="size-4" /><AlertTitle>Channel listing defaults</AlertTitle><AlertDescription>These default rule settings are shown here for reference. Turn off channel policy defaults to create a SKU-level override.</AlertDescription></Alert><div className={useChannelDefaults ? "grid gap-4 opacity-75 md:grid-cols-2 lg:grid-cols-4" : "grid gap-4 md:grid-cols-2 lg:grid-cols-4"}>{select("Price rule", "ebayPricingMode", [{ value: "cost-plus", label: "Cost plus markup" }, { value: "product-price", label: "Use product price" }, { value: "higher-of-product-or-cost", label: "Higher of product or cost" }], useChannelDefaults)}{input("Markup percent", "ebayPriceMarkupPercent", "number", useChannelDefaults)}{input("Minimum margin percent", "ebayMinMarginPercent", "number", useChannelDefaults)}{input("Minimum price", "ebayMinimumPrice", "number", useChannelDefaults)}{select("Quantity source", "ebayQuantityMode", [{ value: "available", label: "Available inventory" }, { value: "qty", label: "On-hand quantity" }, { value: "stockQty", label: "Supplier stock quantity" }], useChannelDefaults)}{select("Rounding", "ebayRoundingRule", [{ value: "none", label: "Nearest cent" }, { value: "nearest .99", label: "Nearest .99" }, { value: "nearest .95", label: "Nearest .95" }, { value: "round up", label: "Round up" }], useChannelDefaults)}</div></TabsContent><TabsContent value="category" className="m-0 grid gap-5"><Alert><Database className="size-4" /><AlertTitle>SKU-specific eBay category</AlertTitle><AlertDescription>These mapping values remain SKU-specific, even when this listing follows eBay channel policy defaults.</AlertDescription></Alert><div className="grid gap-4 md:grid-cols-2"><div className="md:col-span-2">{input("eBay category ID", "ebayCategoryId", "text", false, "Use the eBay category selected for this individual SKU.")}</div>{input("eBay category path", "ebayCategoryPath")}{input("Taxonomy version / tree ID", "ebayTaxonomyVersion")}</div><div className="grid gap-1.5"><Label htmlFor="ebay-sku-item-specifics">Item specifics (JSON)</Label><Textarea id="ebay-sku-item-specifics" rows={12} value={text("ebayItemSpecifics")} onChange={(event) => set("ebayItemSpecifics", event.target.value)} placeholder={'{\n  "Brand": ["Example"],\n  "MPN": ["12345"]\n}'} /><p className="text-xs text-muted-foreground">DataPlus retains category-required specifics and enriches missing values from catalog data when possible.</p></div></TabsContent></div></Tabs><DialogFooter className="border-t px-6 py-4"><Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save eBay settings</Button></DialogFooter></DialogContent></Dialog>
}

// The original eBay editor remains in the file for compatibility with saved
// drafts. New product pages use the listing workspace below.
void ProductEbaySettingsDialog

type EbayCategoryCandidate = {
  id?: string
  categoryId?: string
  name?: string
  fullName?: string
  path?: Array<string | { categoryName?: string; name?: string }>
  taxonomyVersion?: string
  categoryTreeVersion?: string
  source?: string
}

function ebayCategoryCandidatePath(candidate: EbayCategoryCandidate) {
  if (candidate.fullName) return candidate.fullName
  if (Array.isArray(candidate.path)) {
    const parts = candidate.path.map((part) => typeof part === "string" ? part : part.categoryName || part.name || "").filter(Boolean)
    if (parts.length) return parts.join(" > ")
  }
  return candidate.name || "Unnamed eBay category"
}

function EbayListingWorkspace({
  open,
  onOpenChange,
  product,
  channel,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductItem;
  channel: ChannelConnection;
  onUpdated: (product: ProductItem) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [readiness, setReadiness] = useState<{
    status?: string;
    ready?: boolean;
    live?: boolean;
    missing?: string[];
    price?: number;
    quantity?: number;
    purchaseUnits?: { mode?: string; stockAllocation?: string; variants: Array<{ sku: string; label: string; price: number; quantity: number; listingId?: string; listingUrl?: string; offerId?: string }> } | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [activeTab, setActiveTab] = useState("commerce");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [categoryResults, setCategoryResults] = useState<EbayCategoryCandidate[]>([]);
  const [categorySearching, setCategorySearching] = useState(false);
  const [categorySearchError, setCategorySearchError] = useState("");
  const [categorySearchNotice, setCategorySearchNotice] = useState("");
  const [categoryResultsFromDavid, setCategoryResultsFromDavid] = useState(false);
  const listing = product.ebayListing || {};
  const settings = channel.settings || {};
  const overrides = listing.settings || {};
  const locations = Array.isArray(settings.ebayMerchantLocations)
    ? settings.ebayMerchantLocations
    : [];
  const paymentPolicies = Array.isArray(settings.ebayPaymentPolicies)
    ? settings.ebayPaymentPolicies
    : [];
  const returnPolicies = Array.isArray(settings.ebayReturnPolicies)
    ? settings.ebayReturnPolicies
    : [];
  const fulfillmentPolicies = Array.isArray(settings.ebayFulfillmentPolicies)
    ? settings.ebayFulfillmentPolicies
    : [];
  const storeCategories = Array.isArray(settings.ebayStoreCategories)
    ? settings.ebayStoreCategories
    : [];
  const listingTemplates = Array.isArray(settings.ebayListingTemplates)
    ? settings.ebayListingTemplates
    : [];
  const itemSpecificTemplates = Array.isArray(
    settings.ebayItemSpecificTemplates,
  )
    ? settings.ebayItemSpecificTemplates
    : [];

  const text = (key: string) => String(draft[key] ?? "");
  const editorInputClassName =
    "border-slate-300 bg-slate-100/80 shadow-sm transition-colors focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 dark:border-slate-600 dark:bg-slate-950/80";
  const ebayMarketplaceId = String(
    text("ebayMarketplaceId") || settings.ebayMarketplaceId || "EBAY_US",
  )
    .trim()
    .toUpperCase();
  const internalCategoryName = String(product.mainCategory || "").trim();
  const categoryPageHref = internalCategoryName
    ? `/categories/${encodeURIComponent(internalCategoryName)}`
    : "/categories";
  const checked = (key: string, fallback = false) =>
    draft[key] === undefined ? fallback : draft[key] === true;
  const usesChannelDefaults = checked("useChannelDefaults", true);
  const channelPolicyOverrideKeys = new Set([
    "ebayMarketplaceId",
    "ebayDefaultCondition",
    "ebayCurrency",
    "ebayMerchantLocationKey",
    "ebayPaymentPolicyId",
    "ebayReturnPolicyId",
    "ebayFulfillmentPolicyId",
    "ebayStoreCategoryId",
    "ebayListingTemplateId",
    "ebayItemSpecificTemplateId",
    "ebayDispatchTimeDays",
    "ebayPackageType",
    "ebayShippingIrregular",
  ]);
  const change = (key: string, value: string | boolean) =>
    setDraft((current) => ({
      ...current,
      [key]: value,
      ...(channelPolicyOverrideKeys.has(key)
        ? { useChannelDefaults: false }
        : {}),
    }));
  const field = (
    label: string,
    key: string,
    type = "text",
    description = "",
  ) => (
    <FormField className="gap-1.5">
      <FieldLabel htmlFor={`ebay-workspace-${key}`}>{label}</FieldLabel>
      <Input
        id={`ebay-workspace-${key}`}
        className={editorInputClassName}
        type={type}
        min={type === "number" ? 0 : undefined}
        step={type === "number" ? "0.01" : undefined}
        value={text(key)}
        onChange={(event) => change(key, event.target.value)}
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </FormField>
  );
  const select = (
    label: string,
    key: string,
    options: Array<{ value: string; label: string }>,
    description = "",
  ) => {
    const value = text(key);
    const normalized =
      value && !options.some((option) => option.value === value)
        ? [{ value, label: value }, ...options]
        : options;
    return (
      <FormField className="gap-1.5">
        <FieldLabel>{label}</FieldLabel>
        <Select
          value={value || "__none"}
          onValueChange={(next) => change(key, next === "__none" ? "" : next)}
        >
          <SelectTrigger className={editorInputClassName}>
            <SelectValue placeholder="Not selected" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">Not selected</SelectItem>
            {normalized.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {description ? (
          <FieldDescription>{description}</FieldDescription>
        ) : null}
      </FormField>
    );
  };
  const toggle = (
    label: string,
    description: string,
    key: string,
    fallback = false,
  ) => (
    <div className="rounded-md border border-slate-300 bg-slate-100/80 p-3 dark:border-slate-600 dark:bg-slate-950/80">
      <ToggleRow
        label={label}
        description={description}
        checked={checked(key, fallback)}
        disabled={false}
        onCheckedChange={(value) => change(key, value)}
      />
    </div>
  );

  const initialize = () => {
    const inherited = (key: string, fallback: unknown = "") =>
      overrides.useChannelDefaults !== false
        ? (settings[key] ?? fallback)
        : (overrides[key] ?? settings[key] ?? fallback);
    let pendingCategory: EbayCategoryCandidate | null = null;
    try {
      const raw = window.sessionStorage.getItem(`dataplus:ebay-category-selection:${product.sku}`);
      if (raw) pendingCategory = JSON.parse(raw) as EbayCategoryCandidate;
    } catch {
      pendingCategory = null;
    }
    const pendingCategoryId = pendingCategory?.categoryId || pendingCategory?.id || "";
    const pendingCategoryPath = pendingCategory ? ebayCategoryCandidatePath(pendingCategory) : "";
    setCategoryQuery(
      pendingCategoryPath ||
        String(
          overrides.ebayCategoryPath ??
            listing.localCategoryPath ??
            listing.categoryPath ??
            product.mainCategory ??
            product.title ??
            "",
        ),
    );
    setCategoryResults([]);
    setCategoryResultsFromDavid(false);
    setCategorySearchError("");
    setCategorySearchNotice("");
    const specifics =
      overrides.ebayItemSpecifics ??
      (listing.itemSpecifics
        ? JSON.stringify(listing.itemSpecifics, null, 2)
        : "");
    setDraft({
      useChannelDefaults: overrides.useChannelDefaults !== false,
      ebayEnabled: listing.enabled !== false && overrides.ebayEnabled !== false,
      ebayRestricted:
        listing.restricted === true || overrides.ebayRestricted === true,
      ebayRestrictionReason: String(
        listing.restrictionReason ?? overrides.ebayRestrictionReason ?? "",
      ),
      ebayInventoryConnected:
        listing.inventoryConnected !== false &&
        overrides.ebayInventoryConnected !== false,
      ebayUseChannelDefaultQuantity:
        overrides.ebayUseChannelDefaultQuantity !== false,
      ebayUseChannelDefaultSafetyQty:
        overrides.ebayUseChannelDefaultSafetyQty !== false,
      ebayUseChannelDefaultMaxSellableQty:
        overrides.ebayUseChannelDefaultMaxSellableQty !== false,
      ebayUseDefaultPricingFormula:
        overrides.ebayUseDefaultPricingFormula !== false,
      ebayMarketplaceId: String(
        inherited("ebayMarketplaceId", listing.marketplaceId || "EBAY_US"),
      ),
      ebayDefaultCondition: String(
        inherited("ebayDefaultCondition", listing.condition || "NEW"),
      ),
      ebayCurrency: String(
        inherited("ebayCurrency", listing.currency || "USD"),
      ),
      ebayMerchantLocationKey: String(
        inherited("ebayMerchantLocationKey", listing.merchantLocationKey || ""),
      ),
      ebayPaymentPolicyId: String(
        inherited("ebayPaymentPolicyId", listing.paymentPolicyId || ""),
      ),
      ebayReturnPolicyId: String(
        inherited("ebayReturnPolicyId", listing.returnPolicyId || ""),
      ),
      ebayFulfillmentPolicyId: String(
        inherited("ebayFulfillmentPolicyId", listing.fulfillmentPolicyId || ""),
      ),
      ebayPrice: String(overrides.ebayPrice ?? listing.price ?? ""),
      ebayQuantityOverride: String(overrides.ebayQuantityOverride ?? ""),
      ebaySafetyQty: String(overrides.ebaySafetyQty ?? listing.safetyQty ?? ""),
      ebayMaxSellableQty: String(
        overrides.ebayMaxSellableQty ?? listing.maxSellableQty ?? "",
      ),
      ebayMinInventoryForAutoListing: String(
        overrides.ebayMinInventoryForAutoListing ??
          listing.minInventoryForAutoListing ??
          settings.ebayMinInventoryForAutoListing ??
          0,
      ),
      ebayMerchantSku: String(
        overrides.ebayMerchantSku ?? listing.merchantSku ?? product.sku ?? "",
      ),
      ebaySubtitle: String(overrides.ebaySubtitle ?? listing.subtitle ?? ""),
      ebayDispatchTimeDays: String(
        overrides.ebayDispatchTimeDays ??
          listing.dispatchTimeDays ??
          settings.ebayDefaultDispatchTimeDays ??
          2,
      ),
      ebayPackageType: String(
        overrides.ebayPackageType ??
          listing.packageType ??
          settings.ebayDefaultPackageType ??
          "",
      ),
      ebayShippingIrregular:
        overrides.ebayShippingIrregular === true ||
        listing.shippingIrregular === true,
      ebayBestOfferEnabled:
        overrides.ebayBestOfferEnabled === true ||
        listing.bestOfferEnabled === true,
      ebayBestOfferAutoAcceptPrice: String(
        overrides.ebayBestOfferAutoAcceptPrice ??
          listing.bestOfferAutoAcceptPrice ??
          "",
      ),
      ebayBestOfferAutoDeclinePrice: String(
        overrides.ebayBestOfferAutoDeclinePrice ??
          listing.bestOfferAutoDeclinePrice ??
          "",
      ),
      ebayStoreCategoryId: String(
        overrides.ebayStoreCategoryId ?? listing.storeCategoryId ?? "",
      ),
      ebayListingTemplateId: String(
        overrides.ebayListingTemplateId ?? listing.listingTemplateId ?? "",
      ),
      ebayItemSpecificTemplateId: String(
        overrides.ebayItemSpecificTemplateId ??
          listing.itemSpecificTemplateId ??
          "",
      ),
      ebayCategoryId: String(
        overrides.ebayCategoryId ?? pendingCategoryId ?? listing.localCategoryId ?? (listing.sourceOfTruth === "ebay_catalog_sync" ? "" : listing.categoryId) ?? "",
      ),
      ebayCategoryPath: String(
        overrides.ebayCategoryPath ?? pendingCategoryPath ?? listing.localCategoryPath ?? (listing.sourceOfTruth === "ebay_catalog_sync" ? "" : listing.categoryPath) ?? "",
      ),
      ebayTaxonomyVersion: String(
        overrides.ebayTaxonomyVersion ?? pendingCategory?.taxonomyVersion ?? pendingCategory?.categoryTreeVersion ?? listing.taxonomyVersion ?? "",
      ),
      ebayItemSpecifics: String(specifics || ""),
      ebayIdentifierType: String(
        overrides.ebayIdentifierType ?? listing.identifierType ?? "UPC",
      ),
      ebayIdentifierValue: String(
        overrides.ebayIdentifierValue ??
          listing.identifierValue ??
          product.barcode ??
          "",
      ),
      ebayIdentifierUnavailable:
        overrides.ebayIdentifierUnavailable === true ||
        listing.identifierUnavailable === true,
      ebayIdentifierUnavailableText: String(
        overrides.ebayIdentifierUnavailableText ??
          listing.identifierUnavailableText ??
          "Does not apply",
      ),
      ebayEPid: String(overrides.ebayEPid ?? listing.ePid ?? ""),
      ebayMpn: String(
        overrides.ebayMpn ?? listing.mpn ?? product.mfrPartNumber ?? "",
      ),
      ebayProductCompliancePolicyIds: Array.isArray(
        overrides.ebayProductCompliancePolicyIds,
      )
        ? overrides.ebayProductCompliancePolicyIds.join(", ")
        : Array.isArray(listing.productCompliancePolicyIds)
          ? listing.productCompliancePolicyIds.join(", ")
          : "",
    });
    if (pendingCategory) {
      try { window.sessionStorage.removeItem(`dataplus:ebay-category-selection:${product.sku}`); } catch { /* ignore unavailable storage */ }
    }
  };

  const payload = () => {
    const ebaySettings = {
      ...draft,
      ebayProductCompliancePolicyIds: text("ebayProductCompliancePolicyIds")
        .split(/[,\n]+/)
        .map((value) => value.trim())
        .filter(Boolean),
    };
    return {
      ebaySettings,
      enabled: checked("ebayEnabled", true),
      restricted: checked("ebayRestricted"),
      restrictionReason: text("ebayRestrictionReason"),
      inventoryConnected: checked("ebayInventoryConnected", true),
      merchantSku: text("ebayMerchantSku"),
      categoryId: text("ebayCategoryId"),
      categoryPath: text("ebayCategoryPath"),
      taxonomyVersion: text("ebayTaxonomyVersion"),
      itemSpecifics: text("ebayItemSpecifics"),
      identifierType: text("ebayIdentifierType"),
      identifierValue: text("ebayIdentifierValue"),
      identifierUnavailable: checked("ebayIdentifierUnavailable"),
      identifierUnavailableText: text("ebayIdentifierUnavailableText"),
      ePid: text("ebayEPid"),
      mpn: text("ebayMpn"),
      subtitle: text("ebaySubtitle"),
      dispatchTimeDays: text("ebayDispatchTimeDays"),
      packageType: text("ebayPackageType"),
      shippingIrregular: checked("ebayShippingIrregular"),
      bestOfferEnabled: checked("ebayBestOfferEnabled"),
      bestOfferAutoAcceptPrice: text("ebayBestOfferAutoAcceptPrice"),
      bestOfferAutoDeclinePrice: text("ebayBestOfferAutoDeclinePrice"),
      storeCategoryId: text("ebayStoreCategoryId"),
      listingTemplateId: text("ebayListingTemplateId"),
      itemSpecificTemplateId: text("ebayItemSpecificTemplateId"),
      productCompliancePolicyIds: ebaySettings.ebayProductCompliancePolicyIds,
      ...(!checked("ebayUseDefaultPricingFormula", true) && text("ebayPrice") ? { price: text("ebayPrice") } : {}),
      ...(text("ebayQuantityOverride")
        ? { quantity: text("ebayQuantityOverride") }
        : {}),
    };
  };
  const loadReadiness = async () => {
    try {
      const result = await api<{
        readiness?: typeof readiness;
        item?: ProductItem;
      }>(
        `/api/inventory/${encodeURIComponent(product.id || product.sku || "")}/ebay/listing`,
        {
          method: "POST",
          body: JSON.stringify({ action: "readiness", ...payload() }),
        },
      );
      setReadiness(result.readiness || null);
      if (result.item) onUpdated(result.item);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to check eBay listing readiness.",
      );
    }
  };
  useEffect(() => {
    if (!open) return;
    initialize();
    setActiveTab("commerce");
    void loadReadiness();
    // The editor deliberately resets from the latest persisted SKU each time it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product.id, product.updatedAt]);

  const saveDraft = async (quiet = false) => {
    setBusy(true);
    try {
      const result = await api<{ item: ProductItem }>(
        `/api/inventory/${encodeURIComponent(product.id || product.sku || "")}/ebay/listing`,
        {
          method: "POST",
          body: JSON.stringify({ action: "draft", ...payload() }),
        },
      );
      onUpdated(result.item);
      if (!quiet) toast.success("eBay listing draft saved.");
      return result.item;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to save eBay listing settings.",
      );
      return null;
    } finally {
      setBusy(false);
    }
  };
  const runLifecycle = async (
    action: "offer" | "publish" | "revise" | "relist" | "end",
  ) => {
    setBusy(true);
    try {
      const result = await api<{
        item: ProductItem;
        readiness?: typeof readiness;
        published?: boolean;
      }>(
        `/api/inventory/${encodeURIComponent(product.id || product.sku || "")}/ebay/listing`,
        { method: "POST", body: JSON.stringify({ action, ...payload() }) },
      );
      onUpdated(result.item);
      if (result.readiness) setReadiness(result.readiness);
      toast.success(
        action === "end"
          ? "eBay listing ended."
          : action === "relist"
            ? "eBay listing relisted."
            : action === "publish"
              ? "eBay listing published."
              : action === "revise"
                ? "eBay listing revised."
                : "eBay offer created or updated.",
      );
      void loadReadiness();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to update the eBay listing.",
      );
    } finally {
      setBusy(false);
      setEnding(false);
    }
  };
  const syncAttributes = async () => {
    setBusy(true);
    try {
      const result = await api<{ item: ProductItem }>(
        `/api/inventory/${encodeURIComponent(product.id || product.sku || "")}/ebay/attributes/sync`,
        { method: "POST", body: JSON.stringify({}) },
      );
      onUpdated(result.item);
      toast.success("eBay category attributes refreshed.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to load eBay category attributes.",
      );
    } finally {
      setBusy(false);
    }
  };
  const searchEbayCategories = async (askDavid = false) => {
    const query =
      categoryQuery.trim() ||
      text("ebayCategoryPath") ||
      product.mainCategory ||
      product.title ||
      "";
    if (!query) {
      setCategorySearchError("Enter a product title or category phrase first.");
      return;
    }
    setCategorySearching(true);
    setCategorySearchError("");
    setCategorySearchNotice("");
    try {
      const result = await api<{
        categories?: EbayCategoryCandidate[];
        message?: string;
        warning?: string;
      }>(
        askDavid
          ? "/api/ai/ebay-category-research"
          : `/api/channel-taxonomies/ebay/categories?q=${encodeURIComponent(query)}&limit=20&marketplaceId=${encodeURIComponent(ebayMarketplaceId)}`,
        askDavid
          ? {
              method: "POST",
              body: JSON.stringify({
                query,
                marketplaceId: ebayMarketplaceId,
                product: {
                  sku: product.sku,
                  title: product.title,
                  mainCategory: product.mainCategory,
                },
              }),
            }
          : undefined,
      );
      const categories = Array.isArray(result.categories) ? result.categories : [];
      setCategoryResults(categories);
      setCategoryResultsFromDavid(askDavid && categories.length > 0);
      setCategorySearchNotice(result.warning || "");
      if (!categories.length) {
        setCategorySearchError(
          result.message || "No eBay category matches were returned.",
        );
      }
    } catch (error) {
      setCategoryResults([]);
      setCategoryResultsFromDavid(false);
      setCategorySearchError(
        error instanceof Error
          ? error.message
          : "Unable to search eBay categories.",
      );
    } finally {
      setCategorySearching(false);
    }
  };
  const chooseEbayCategory = (candidate: EbayCategoryCandidate) => {
    const categoryId = String(candidate.categoryId || candidate.id || "");
    const categoryPath = ebayCategoryCandidatePath(candidate);
    change("ebayCategoryId", categoryId);
    change("ebayCategoryPath", categoryPath);
    change(
      "ebayTaxonomyVersion",
      String(candidate.taxonomyVersion || candidate.categoryTreeVersion || ""),
    );
    setCategoryQuery(categoryPath);
    setCategoryResults([]);
    setCategoryResultsFromDavid(false);
    setCategorySearchError("");
    setCategorySearchNotice("");
    toast.success(`Selected eBay category ${categoryId || categoryPath}.`);
  };

  const listingStatus = String(
    readiness?.status || listing.status || "draft",
  ).replace(/[-_]/g, " ");
  const cost = Number(product.sellUnitCost ?? product.cost ?? 0);
  const configuredPrice = Number(
    text("ebayPrice") || readiness?.price || listing.price || 0,
  );
  const margin =
    configuredPrice > 0
      ? ((configuredPrice - cost) / configuredPrice) * 100
      : 0;
  const attributes = Array.isArray(product.ebayListing?.categoryAttributes)
    ? product.ebayListing?.categoryAttributes
    : Array.isArray(listing.categoryAttributes)
      ? listing.categoryAttributes
      : [];
  const history = Array.isArray(product.ebayListing?.history)
    ? product.ebayListing?.history
    : [];
  const measurementValue = (...values: Array<string | number | undefined>) => {
    for (const value of values) {
      const numeric = Number(value ?? 0);
      if (Number.isFinite(numeric) && numeric > 0) {
        return Math.round(numeric * 100) / 100;
      }
    }
    return 0;
  };
  const packageWeight = measurementValue(
    product.packageWeight,
    product.itemWeight,
  );
  const dimensionalWeight = measurementValue(product.dimensionalWeight);
  const packageLength = measurementValue(
    product.packageLength,
    product.itemLength,
  );
  const packageWidth = measurementValue(
    product.packageWidth,
    product.itemWidth,
  );
  const packageHeight = measurementValue(
    product.packageHeight,
    product.itemHeight,
  );
  const hasPackageWeight = packageWeight > 0;
  const hasPackageDimensions =
    packageLength > 0 && packageWidth > 0 && packageHeight > 0;
  const hasEbayWeight = hasPackageWeight || dimensionalWeight > 0;
  const packageReady = hasEbayWeight && hasPackageDimensions;
  const packageTypeOptions = [
    { value: "PACKAGE_THICK_ENVELOPE", label: "Package / thick envelope" },
    { value: "PARCEL_OR_PADDED_ENVELOPE", label: "Parcel or padded envelope" },
    { value: "PADDED_BAGS", label: "Padded bag" },
    { value: "LARGE_ENVELOPE", label: "Large envelope" },
    { value: "USPS_FLAT_RATE_ENVELOPE", label: "USPS flat-rate envelope" },
    { value: "USPS_LARGE_PACK", label: "USPS large pack" },
    { value: "EXTRA_LARGE_PACK", label: "Extra large pack" },
    { value: "VERY_LARGE_PACK", label: "Very large pack" },
    { value: "BULKY_GOODS", label: "Bulky goods" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(94vh,960px)] max-w-[calc(100vw-0.75rem)] flex-col overflow-hidden p-0 sm:max-w-7xl">
        <DialogHeader className="border-b bg-muted/25 px-6 py-5">
          <div className="flex flex-wrap items-start justify-between gap-3 pr-8">
            <div>
              <DialogTitle className="flex items-center gap-2">
                eBay listing workspace{" "}
                <Badge
                  variant={readiness?.live ? "default" : "secondary"}
                  className="capitalize"
                >
                  {listingStatus}
                </Badge>
              </DialogTitle>
              <DialogDescription className="mt-1">
                SKU <span className="font-mono font-medium">{product.sku}</span>{" "}
                · eBay listings and purchase units.
              </DialogDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              {listing.listingUrl ? (
                <Button asChild size="sm" variant="outline">
                  <a href={listing.listingUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                    View on eBay
                  </a>
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void loadReadiness()}
                disabled={busy}
              >
                <RefreshCw
                  className={busy ? "size-4 animate-spin" : "size-4"}
                />
                Refresh readiness
              </Button>
            </div>
          </div>
        </DialogHeader>
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="overflow-x-auto border-b bg-background px-4">
            <TabsList className="h-auto min-w-max bg-transparent p-1">
              <TabsTrigger value="readiness">Readiness</TabsTrigger>
              <TabsTrigger value="commerce">Price & inventory</TabsTrigger>
              <TabsTrigger value="listing">Listing</TabsTrigger>
              <TabsTrigger value="shipping">Shipping package</TabsTrigger>
              <TabsTrigger value="policies">Policies</TabsTrigger>
              <TabsTrigger value="details">Identifiers & specifics</TabsTrigger>
              <TabsTrigger value="history">
                History ({history.length})
              </TabsTrigger>
            </TabsList>
          </div>
          <ScrollArea className="min-h-0 flex-1">
            <div className="px-6 py-5">
              {readiness?.purchaseUnits && <section className="mb-5 min-w-0 border-b pb-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Purchase units</h3><Badge variant="outline">{readiness.purchaseUnits.mode === 'group' ? 'One listing' : readiness.purchaseUnits.mode === 'separate' ? 'Separate listings' : 'Category check pending'}</Badge></div>
                <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Option / SKU</TableHead><TableHead>eBay price</TableHead><TableHead>Quantity</TableHead><TableHead>Listing</TableHead></TableRow></TableHeader><TableBody>{readiness.purchaseUnits.variants.map(unit => <TableRow key={unit.sku}><TableCell className="max-w-64 whitespace-normal break-all"><span className="font-medium">{unit.label}</span><div className="text-xs text-muted-foreground">{unit.sku}</div></TableCell><TableCell>{moneyLabel(unit.price)}</TableCell><TableCell>{numberLabel(unit.quantity)}</TableCell><TableCell>{unit.listingUrl ? <a className="text-primary underline" href={unit.listingUrl} target="_blank" rel="noreferrer">{unit.listingId}</a> : unit.offerId ? 'Prepared, not live' : 'Not created'}</TableCell></TableRow>)}</TableBody></Table></div>
              </section>}
              <TabsContent value="readiness" className="m-0 grid gap-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Card>
                    <CardHeader className="p-4">
                      <CardDescription>Listing state</CardDescription>
                      <CardTitle className="mt-1 capitalize">
                        {listingStatus}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="p-4">
                      <CardDescription>{readiness?.purchaseUnits ? 'eBay price from' : 'eBay price'}</CardDescription>
                      <CardTitle className="mt-1">
                        {moneyLabel(readiness?.price ?? configuredPrice)}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="p-4">
                      <CardDescription>Sendable quantity</CardDescription>
                      <CardTitle className="mt-1">
                        {numberLabel(
                          readiness?.quantity ?? listing.quantity ?? 0,
                        )}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                </div>
                {readiness?.missing?.length ? (
                  <Alert variant="destructive">
                    <AlertCircle className="size-4" />
                    <AlertTitle>Listing is not ready</AlertTitle>
                    <AlertDescription>
                      {readiness.missing.join(" · ")}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <Alert>
                    <CheckCircle2 className="size-4" />
                    <AlertTitle>
                      {readiness?.live
                        ? "Listing is live"
                        : "Ready for the next listing action"}
                    </AlertTitle>
                    <AlertDescription>
                      {readiness?.live
                        ? "Use Revise to send listing changes, or End listing to remove it from eBay."
                        : "Save the draft, create the offer, then publish when this SKU is ready."}
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex flex-wrap gap-2">
                  {listing.listingUrl ? (
                    <Button asChild variant="outline">
                      <a
                        href={listing.listingUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink className="size-4" />
                        View in channel
                      </a>
                    </Button>
                  ) : null}
                  <Button
                    variant="outline"
                    onClick={() => void saveDraft()}
                    disabled={busy}
                  >
                    <Save className="size-4" />
                    Save draft
                  </Button>
                  {listing.offerId || listing.listingId ? (
                    <Button
                      variant="outline"
                      onClick={() => void runLifecycle("revise")}
                      disabled={busy || !readiness?.ready}
                    >
                      <RefreshCw className="size-4" />
                      Revise listing
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={() => void runLifecycle("offer")}
                      disabled={busy || !readiness?.ready}
                    >
                      <PackageSearch className="size-4" />
                      Create offer
                    </Button>
                  )}
                  {listing.listingId ? (
                    <Button
                      variant="outline"
                      onClick={() => void runLifecycle("relist")}
                      disabled={busy || !readiness?.ready}
                    >
                      <RotateCcw className="size-4" />
                      Relist
                    </Button>
                  ) : (
                    <Button
                      onClick={() => void runLifecycle("publish")}
                      disabled={busy || !readiness?.ready}
                    >
                      <Store className="size-4" />
                      Publish listing
                    </Button>
                  )}
                  {listing.listingId ? (
                    <Button
                      variant="destructive"
                      onClick={() => setEnding(true)}
                      disabled={busy}
                    >
                      <Archive className="size-4" />
                      End listing
                    </Button>
                  ) : null}
                </div>
              </TabsContent>
              <TabsContent value="commerce" className="m-0 grid gap-5">
                <Alert>
                  <Settings className="size-4" />
                  <AlertTitle>Commercial controls</AlertTitle>
                  <AlertDescription>
                    Override a channel setting only when this SKU needs its own
                    pricing or inventory behavior.
                  </AlertDescription>
                </Alert>
                <div className="grid gap-3 md:grid-cols-2">
                  {toggle(
                    "Enable this SKU on eBay",
                    "Disabled SKUs stay out of listing jobs without losing their eBay draft.",
                    "ebayEnabled",
                    true,
                  )}
                  {toggle(
                    "Restrict this listing",
                    "Use a reason to keep a policy, safety, or compliance hold visible.",
                    "ebayRestricted",
                  )}
                  {toggle(
                    "Use channel default price formula",
                    "Turn off to specify this SKU's eBay selling price.",
                    "ebayUseDefaultPricingFormula",
                    true,
                  )}
                  {toggle(
                    "Inventory is connected",
                    "When off, eBay uses the manual quantity override rather than your live inventory.",
                    "ebayInventoryConnected",
                    true,
                  )}
                  {toggle(
                    "Use channel default quantity",
                    "When off, eBay sends the actual available inventory.",
                    "ebayUseChannelDefaultQuantity",
                    true,
                  )}
                  {toggle(
                    "Use channel default safety quantity",
                    "When off, define the safety stock for this SKU.",
                    "ebayUseChannelDefaultSafetyQty",
                    true,
                  )}
                  {toggle(
                    "Use channel default max sellable quantity",
                    "When off, cap this SKU's eBay quantity independently.",
                    "ebayUseChannelDefaultMaxSellableQty",
                    true,
                  )}
                </div>
                {checked("ebayRestricted") ? (
                  <div className="max-w-xl">
                    {field(
                      "Restriction reason",
                      "ebayRestrictionReason",
                      "text",
                      "This reason appears in listing readiness and review exports.",
                    )}
                  </div>
                ) : null}
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {!checked("ebayUseDefaultPricingFormula", true) ? (
                    field(
                      "Fixed eBay price",
                      "ebayPrice",
                      "number",
                      "Cost is " +
                        moneyLabel(cost) +
                        `; projected margin ${margin.toFixed(1)}%.`,
                    )
                  ) : (
                    <Card className="border-dashed">
                      <CardHeader className="p-4">
                        <CardDescription>Channel formula</CardDescription>
                        <CardTitle className="mt-1 text-base">
                          {String(settings.ebayPricingMode || "cost-plus")}
                        </CardTitle>
                        <CardDescription className="mt-1">
                          Target{" "}
                          {moneyLabel(readiness?.price ?? listing.price ?? 0)}
                        </CardDescription>
                      </CardHeader>
                    </Card>
                  )}
                  {!checked("ebayInventoryConnected", true)
                    ? field(
                        "Manual eBay quantity",
                        "ebayQuantityOverride",
                        "number",
                        "This value remains stable until you change it.",
                      )
                    : null}
                  {!checked("ebayUseChannelDefaultSafetyQty", true)
                    ? field("SKU safety quantity", "ebaySafetyQty", "number")
                    : null}
                  {!checked("ebayUseChannelDefaultMaxSellableQty", true)
                    ? field(
                        "SKU max sellable quantity",
                        "ebayMaxSellableQty",
                        "number",
                      )
                    : null}
                  {field(
                    "Minimum inventory for auto-listing",
                    "ebayMinInventoryForAutoListing",
                    "number",
                    "Listing jobs hold the SKU below this amount.",
                  )}
                </div>
              </TabsContent>
              <TabsContent value="listing" className="m-0 grid gap-5">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {field(
                    "eBay merchant SKU",
                    "ebayMerchantSku",
                    "text",
                    "Defaults to your DataPlus SKU.",
                  )}
                  {field("Subtitle", "ebaySubtitle", "text")}
                  {select("Condition", "ebayDefaultCondition", [
                    { value: "NEW", label: "New" },
                    { value: "NEW_WITH_DEFECTS", label: "New with defects" },
                    { value: "USED_EXCELLENT", label: "Used - Excellent" },
                    { value: "USED_VERY_GOOD", label: "Used - Very good" },
                    { value: "USED_GOOD", label: "Used - Good" },
                    { value: "USED_ACCEPTABLE", label: "Used - Acceptable" },
                  ])}
                  {field(
                    "Dispatch time (days)",
                    "ebayDispatchTimeDays",
                    "number",
                  )}
                  {select("Marketplace", "ebayMarketplaceId", [
                    { value: "EBAY_US", label: "United States" },
                    { value: "EBAY_CA", label: "Canada" },
                    { value: "EBAY_GB", label: "United Kingdom" },
                    { value: "EBAY_AU", label: "Australia" },
                  ])}
                  {field("Currency", "ebayCurrency")}
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {toggle(
                    "Enable Best Offer",
                    "Offer terms are sent when the listing is created or revised.",
                    "ebayBestOfferEnabled",
                  )}
                  {checked("ebayBestOfferEnabled")
                    ? field(
                        "Auto accept at or above",
                        "ebayBestOfferAutoAcceptPrice",
                        "number",
                      )
                    : null}
                  {checked("ebayBestOfferEnabled")
                    ? field(
                        "Auto decline below",
                        "ebayBestOfferAutoDeclinePrice",
                        "number",
                      )
                    : null}
                </div>
              </TabsContent>
              <TabsContent value="shipping" className="m-0 grid gap-5">
                <Alert variant={packageReady ? "default" : "destructive"}>
                  <Truck className="size-4" />
                  <AlertTitle>
                    {packageReady
                      ? "Package details are ready for eBay"
                      : "Package details need attention"}
                  </AlertTitle>
                  <AlertDescription>
                    DataPlus sends these catalog package measurements with the
                    eBay inventory item. Weight is required by eBay for shipping
                    policies that calculate rates from the package.
                  </AlertDescription>
                </Alert>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <Card>
                    <CardHeader className="p-4">
                      <CardDescription>Package weight</CardDescription>
                      <CardTitle className="mt-1 text-base">
                        {hasPackageWeight ? `${packageWeight} lb` : "Not recorded"}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="p-4">
                      <CardDescription>Package dimensions</CardDescription>
                      <CardTitle className="mt-1 text-base">
                        {hasPackageDimensions
                          ? `${packageLength} x ${packageWidth} x ${packageHeight} in`
                          : "Not recorded"}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="p-4">
                      <CardDescription>Dimensional weight</CardDescription>
                      <CardTitle className="mt-1 text-base">
                        {Number(product.dimensionalWeight || 0) > 0
                          ? `${Number(product.dimensionalWeight).toFixed(2)} lb`
                          : "Not recorded"}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader className="p-4">
                      <CardDescription>Shipping class</CardDescription>
                      <CardTitle className="mt-1 text-base capitalize">
                        {product.shippingClass || product.shippingMethod || "Not recorded"}
                      </CardTitle>
                    </CardHeader>
                  </Card>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {select(
                    "eBay package type",
                    "ebayPackageType",
                    packageTypeOptions,
                    "Leave blank unless eBay requires a specific package classification.",
                  )}
                  {toggle(
                    "Irregular package",
                    "Marks this SKU as irregular for eBay calculated shipping.",
                    "ebayShippingIrregular",
                  )}
                </div>
                <FieldDescription>
                  Edit the measured package weight and dimensions in the product
                  Shipping section. This tab controls the eBay-specific package
                  classification sent with those measurements.
                </FieldDescription>
              </TabsContent>
              <TabsContent value="policies" className="m-0 grid gap-5">
                <Alert>
                  <ShieldCheck className="size-4" />
                  <AlertTitle>Seller policies and templates</AlertTitle>
                  <AlertDescription>
                    Policy choices are imported from the eBay seller account.
                    They can stay at the channel default or be made SKU-specific
                    here.
                  </AlertDescription>
                </Alert>
                <div className="rounded-md border border-primary/25 bg-primary/5 p-4">
                  <ToggleRow
                    label="Use eBay channel policy defaults"
                    description="When enabled, this SKU inherits marketplace, condition, merchant location, and seller policies from Channels > eBay. Pricing and inventory keep their own SKU-level controls."
                    checked={usesChannelDefaults}
                    disabled={false}
                    onCheckedChange={(value) =>
                      change("useChannelDefaults", value)
                    }
                  />
                </div>
                <Alert>
                  <Settings className="size-4" />
                  <AlertTitle>
                    {usesChannelDefaults
                      ? "Using eBay channel policy defaults"
                      : "Using SKU-specific eBay policies"}
                  </AlertTitle>
                  <AlertDescription>
                    {usesChannelDefaults
                      ? "Select a policy below or turn this switch off to make this SKU independent from the channel defaults."
                      : "Changes below apply only to this SKU and do not change the eBay channel defaults."}
                  </AlertDescription>
                </Alert>
                <div className="grid gap-4 md:grid-cols-2">
                  {select(
                    "Merchant location",
                    "ebayMerchantLocationKey",
                    locations
                      .map((location: any) => ({
                        value: String(
                          location.merchantLocationKey || location.key || "",
                        ),
                        label: String(
                          location.name ||
                            location.merchantLocationKey ||
                            location.key ||
                            "Location",
                        ),
                      }))
                      .filter((option) => option.value),
                  )}
                  {select(
                    "Payment policy",
                    "ebayPaymentPolicyId",
                    paymentPolicies
                      .map((policy: any) => ({
                        value: String(policy.id || ""),
                        label: String(policy.name || policy.id || "Policy"),
                      }))
                      .filter((option) => option.value),
                  )}
                  {select(
                    "Return policy",
                    "ebayReturnPolicyId",
                    returnPolicies
                      .map((policy: any) => ({
                        value: String(policy.id || ""),
                        label: String(policy.name || policy.id || "Policy"),
                      }))
                      .filter((option) => option.value),
                  )}
                  {select(
                    "Fulfillment policy",
                    "ebayFulfillmentPolicyId",
                    fulfillmentPolicies
                      .map((policy: any) => ({
                        value: String(policy.id || ""),
                        label: String(policy.name || policy.id || "Policy"),
                      }))
                      .filter((option) => option.value),
                  )}
                  {select(
                    "Store category",
                    "ebayStoreCategoryId",
                    storeCategories
                      .map((category: any) => ({
                        value: String(category.id || category.categoryId || ""),
                        label: String(
                          category.name ||
                            category.categoryName ||
                            category.id ||
                            "Store category",
                        ),
                      }))
                      .filter((option) => option.value),
                  )}
                  {select(
                    "Listing template",
                    "ebayListingTemplateId",
                    listingTemplates
                      .map((template: any) => ({
                        value: String(template.id || ""),
                        label: String(
                          template.name || template.id || "Template",
                        ),
                      }))
                      .filter((option) => option.value),
                  )}
                  {select(
                    "Item specifics template",
                    "ebayItemSpecificTemplateId",
                    itemSpecificTemplates
                      .map((template: any) => ({
                        value: String(template.id || ""),
                        label: String(
                          template.name || template.id || "Template",
                        ),
                      }))
                      .filter((option) => option.value),
                  )}
                </div>
              </TabsContent>
              <TabsContent value="details" className="m-0 grid gap-5">
                <Card className="border-slate-300 bg-slate-50/90 dark:border-slate-700 dark:bg-slate-900/80">
                  <CardHeader className="p-4 pb-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">Find eBay category</CardTitle>
                        <CardDescription>
                          Search the locally cached eBay taxonomy, or ask David to suggest a category from this product.
                          Selecting a result fills the ID, full path, and taxonomy version below.
                        </CardDescription>
                      </div>
                      {internalCategoryName ? (
                        <Button size="sm" variant="outline" className="h-8 shrink-0" asChild>
                          <a href={categoryPageHref} onClick={() => onOpenChange(false)}>
                            <ExternalLink className="size-3.5" />
                            View category
                          </a>
                        </Button>
                      ) : null}
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-3 p-4 pt-0">
                    <p className="text-xs text-muted-foreground">
                      Searches the eBay taxonomy cached in DataPlus. David uses the same cached candidates; neither action contacts eBay.
                    </p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        className={editorInputClassName}
                        value={categoryQuery}
                        onChange={(event) => setCategoryQuery(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void searchEbayCategories();
                          }
                        }}
                        placeholder="Search eBay category, product, or taxonomy phrase"
                        aria-label="Search eBay categories"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void searchEbayCategories()}
                        disabled={categorySearching}
                      >
                        {categorySearching ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Search className="size-4" />
                        )}
                        Search cached categories
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void searchEbayCategories(true)}
                        disabled={categorySearching}
                      >
                        <MessageSquare className="size-4" />
                        Ask David
                      </Button>
                    </div>
                    {categorySearchNotice ? (
                      <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                        {categorySearchNotice}
                      </p>
                    ) : null}
                    {categorySearchError ? (
                      <Alert variant="destructive" className="py-3">
                        <AlertCircle className="size-4" />
                        <AlertDescription>{categorySearchError}</AlertDescription>
                      </Alert>
                    ) : null}
                    {categoryResults.length ? (
                      <div className={`max-h-72 overflow-y-auto rounded-md border ${categoryResultsFromDavid ? "ai-result-surface" : "bg-background"}`}>
                        <div className={`border-b px-3 py-2 text-xs font-medium ${categoryResultsFromDavid ? "ai-result-text" : "text-muted-foreground"}`}>
                          {categoryResultsFromDavid ? "David ranked" : "Found"} {categoryResults.length} eBay category matches
                        </div>
                        <div className="divide-y">
                          {categoryResults.map((candidate, index) => {
                            const categoryId = String(
                              candidate.categoryId || candidate.id || "",
                            );
                            const categoryPath = ebayCategoryCandidatePath(candidate);
                            return (
                              <div
                                key={`${categoryId || categoryPath}-${index}`}
                                className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                              >
                                <div className="min-w-0">
                                  <div className={`font-medium ${categoryResultsFromDavid ? "ai-result-text" : ""}`}>{categoryPath}</div>
                                  <div className={`font-mono text-xs ${categoryResultsFromDavid ? "ai-result-text" : "text-muted-foreground"}`}>
                                    Category ID {categoryId || "not returned"}
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => chooseEbayCategory(candidate)}
                                >
                                  Use category
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
                <div className="grid gap-4 rounded-lg border border-slate-300 bg-slate-50/90 p-4 dark:border-slate-700 dark:bg-slate-900/80 md:grid-cols-2 xl:grid-cols-3">
                  {select("Product identifier type", "ebayIdentifierType", [
                    { value: "UPC", label: "UPC" },
                    { value: "EAN", label: "EAN" },
                    { value: "ISBN", label: "ISBN" },
                    { value: "MPN", label: "MPN" },
                  ])}
                  {field("Identifier value", "ebayIdentifierValue")}
                  {field("ePID", "ebayEPid")}
                  {field("MPN", "ebayMpn")}
                  {field("eBay category ID", "ebayCategoryId")}
                  {field("Category path", "ebayCategoryPath")}
                  <FormField className="gap-1.5">
                    <FieldLabel htmlFor="ebay-workspace-ebayTaxonomyVersion">
                      Category tree / taxonomy
                    </FieldLabel>
                    <Input
                      id="ebay-workspace-ebayTaxonomyVersion"
                      className={editorInputClassName}
                      value={text("ebayTaxonomyVersion")}
                      onChange={(event) =>
                        change("ebayTaxonomyVersion", event.target.value)
                      }
                    />
                    <FieldDescription>
                      eBay taxonomy version for this SKU. View category opens the internal main-category settings.
                    </FieldDescription>
                  </FormField>
                </div>
                {toggle(
                  "Identifier does not apply",
                  "Use only when eBay allows the product identifier exemption for this listing.",
                  "ebayIdentifierUnavailable",
                )}
                {checked("ebayIdentifierUnavailable") ? (
                  <div className="max-w-md">
                    {field(
                      "Identifier exemption note",
                      "ebayIdentifierUnavailableText",
                    )}
                  </div>
                ) : null}
                <FormField className="gap-1.5 rounded-lg border border-slate-300 bg-slate-50/90 p-4 dark:border-slate-700 dark:bg-slate-900/80">
                  <FieldLabel htmlFor="ebay-workspace-specifics">
                    Item specifics
                  </FieldLabel>
                  <Textarea
                    id="ebay-workspace-specifics"
                    className={editorInputClassName}
                    rows={10}
                    value={text("ebayItemSpecifics")}
                    onChange={(event) =>
                      change("ebayItemSpecifics", event.target.value)
                    }
                    placeholder={
                      '{\n  "Brand": ["Example"],\n  "MPN": ["12345"]\n}'
                    }
                  />
                  <FieldDescription>
                    Use JSON or one{" "}
                    <span className="font-mono">Name: Value</span> per line.
                    Required aspects are shown below.
                  </FieldDescription>
                </FormField>
                <Card className="border-slate-300 bg-slate-50/90 dark:border-slate-700 dark:bg-slate-900/80">
                  <CardHeader className="flex flex-row items-start justify-between gap-4">
                    <div>
                      <CardTitle className="text-base">
                        Category-required item specifics
                      </CardTitle>
                      <CardDescription>
                        {attributes.length
                          ? `${attributes.length} attributes cached for this eBay category.`
                          : "No item-specific requirements are cached for this category yet."}
                      </CardDescription>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void syncAttributes()}
                      disabled={busy || !text("ebayCategoryId")}
                    >
                      <RefreshCw className="size-4" />
                      Refresh from eBay
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {attributes.length ? (
                      <div className="flex flex-wrap gap-2">
                        {attributes.map((attribute, index) => (
                          <Badge
                            key={`${attribute.id || attribute.name || "attribute"}-${index}`}
                            variant={
                              attribute.required ? "destructive" : "secondary"
                            }
                          >
                            {String(
                              attribute.name || attribute.id || "Attribute",
                            )}
                            {attribute.required ? " required" : " optional"}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Save a category ID, then load the eBay category
                        attributes.
                      </p>
                    )}
                  </CardContent>
                </Card>
                <FormField className="gap-1.5">
                  <FieldLabel htmlFor="ebay-workspace-compliance">
                    Product compliance policy IDs
                  </FieldLabel>
                  <Input
                    id="ebay-workspace-compliance"
                    className={editorInputClassName}
                    value={text("ebayProductCompliancePolicyIds")}
                    onChange={(event) =>
                      change(
                        "ebayProductCompliancePolicyIds",
                        event.target.value,
                      )
                    }
                    placeholder="Comma-separated eBay policy IDs"
                  />
                  <FieldDescription>
                    Attach any category or regulatory compliance policies
                    required by eBay.
                  </FieldDescription>
                </FormField>
              </TabsContent>
              <TabsContent value="history" className="m-0">
                <Card>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>When</TableHead>
                          <TableHead>Action</TableHead>
                          <TableHead>Message</TableHead>
                          <TableHead>Offer / listing</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {history.length ? (
                          history.map((entry, index) => (
                            <TableRow key={entry.id || `${entry.at}-${index}`}>
                              <TableCell className="whitespace-nowrap text-xs">
                                {entry.at
                                  ? new Date(entry.at).toLocaleString()
                                  : "-"}
                              </TableCell>
                              <TableCell className="capitalize">
                                {String(entry.action || "updated").replace(
                                  /[_-]/g,
                                  " ",
                                )}
                              </TableCell>
                              <TableCell>{entry.message || "-"}</TableCell>
                              <TableCell className="font-mono text-xs">
                                {entry.listingId || entry.offerId || "-"}
                              </TableCell>
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell
                              colSpan={4}
                              className="py-10 text-center text-muted-foreground"
                            >
                              No eBay listing events are recorded for this SKU
                              yet.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
        <DialogFooter className="border-t px-6 py-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Close
          </Button>
          <Button onClick={() => void saveDraft()} disabled={busy}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Save eBay draft
          </Button>
        </DialogFooter>
        <AlertDialog open={ending} onOpenChange={setEnding}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>End this eBay listing?</AlertDialogTitle>
              <AlertDialogDescription>
                The offer will be withdrawn from eBay. The DataPlus listing
                history will retain the action and you can later create a new
                offer or relist it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep listing</AlertDialogCancel>
              <AlertDialogAction onClick={() => void runLifecycle("end")}>
                End listing
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function MeasurementInputs({
  prefix,
  draft,
  disabled,
  onChange,
}: {
  prefix: "item" | "package";
  draft: Record<string, string | number | boolean | string[]>;
  disabled: boolean;
  onChange: (key: string, value: string) => void;
}) {
  const fields = [
    ["Length", `${prefix}Length`],
    ["Width", `${prefix}Width`],
    ["Height", `${prefix}Height`],
    ["Weight", `${prefix}Weight`],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {fields.map(([label, key]) => (
        <div key={key} className="grid gap-1.5">
          <Label>
            {label}
            {label === "Weight" ? " (lb)" : " (in)"}
          </Label>
          <Input
            disabled={disabled}
            type="number"
            min="0"
            step="0.001"
            value={String(draft[key] ?? 0)}
            onChange={(event) => onChange(key, event.target.value)}
          />
        </div>
      ))}
    </div>
  );
}

function ToggleRow({ label, description, checked, disabled, onCheckedChange }: { label: string; description: string; checked: boolean; disabled: boolean; onCheckedChange: (checked: boolean) => void }) {
  return <div className="flex items-start justify-between gap-4"><div><p className="text-sm font-medium">{label}</p><p className="text-xs text-muted-foreground">{description}</p></div><Switch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} /></div>
}
