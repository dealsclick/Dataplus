import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { Activity, AlertCircle, AlertTriangle, ArrowRight, Boxes, Camera, CheckCircle2, ChevronDown, Copy, Database, ExternalLink, Eye, FileDown, FileText, FileUp, Flashlight, Loader2, LockKeyhole, MessageSquare, MoreHorizontal, Pencil, Play, Plus, Printer, RefreshCw, Save, ScanBarcode, ScanSearch, Search, Settings, Share2, Sparkles, Store, Trash2, Truck, Users, Warehouse, X } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { BinLabelDialog } from "./bin-label-dialog"
import { WarehouseMobile } from "./warehouse-mobile"
import { OutboundAuditWorkspace } from "./outbound-audit-workspace"
import { VendorCreateDialog } from "./vendor-create-dialog"
import { api, dateLabel, moneyLabel, numberLabel } from "../lib/client-api"
import { compressEvidenceImage, startFastBarcodeScanner } from "../lib/fast-barcode-scanner"
import { Detail, Field, PageHeader, ProductDetailSheet } from "../App"
import type { CatalogItem, ImportJob, LiteState, SystemSettings, Vendor } from "../App"
type WarehouseRegisterRecord = {
  id?: string
  code?: string
  name?: string
  status?: string
  warehouseType?: string
  inventorySourceType?: string
  isPhysical?: boolean
  allowReceiving?: boolean
  allowAudits?: boolean
  isSellable?: boolean
  capacityUnits?: number
  fulfillmentNetwork?: string
  dropshipVendorId?: string
  managedByVendorFeed?: boolean
  sourceManaged?: boolean
  vendorId?: string
  vendorName?: string
  vendorFeedIds?: string[]
  sourceFeedNames?: string[]
  sourceFeedTransport?: string
  contactName?: string
  managerName?: string
  phone?: string
  email?: string
  timezone?: string
  operatingHours?: string
  carrierCutoffTime?: string
  receivingInstructions?: string
  bins?: Array<Record<string, unknown>>
  addressLine1?: string
  addressLine2?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  isDefaultReceiving?: boolean
  isDefaultReturns?: boolean
  requireAppointment?: boolean
  allowBlindReceipts?: boolean
  requireSerialScan?: boolean
  requirePhotoForDamage?: boolean
  autoRouteReturns?: boolean
  requireBinValidation?: boolean
  shopifyLocationId?: string
  shopifyLocationName?: string
  shopifyInventoryPushEnabled?: boolean
  channelWarehouseMappings?: Array<{
    channel: string
    localDisplayName: string
    externalWarehouseId: string
    externalWarehouseName: string
    enabled: boolean
  }>
  notes?: string
  createdAt?: string
  updatedAt?: string
}

type WarehouseActivityRecord = {
  id?: string
  type?: string
  title?: string
  message?: string
  reference?: string
  user?: string
  source?: string
  createdAt?: string
}

type WarehouseDetailPayload = {
  warehouse: WarehouseRegisterRecord
  summary?: { totalBins?: number; activeBins?: number; totalAudits?: number; openAudits?: number; receipts?: number; movements?: number }
  activity?: WarehouseActivityRecord[]
  audits?: Array<Record<string, unknown>>
  receipts?: Array<Record<string, unknown>>
  movements?: Array<Record<string, unknown>>
}

const WAREHOUSE_TYPE_OPTIONS = [
  { value: "Physical Warehouse", description: "Owned stock location with bins, receiving, and audits.", inventorySourceType: "physical", isPhysical: true, allowReceiving: true, allowAudits: true },
  { value: "Distribution Center", description: "High-volume inbound, storage, and outbound distribution facility.", inventorySourceType: "physical", isPhysical: true, allowReceiving: true, allowAudits: true },
  { value: "Fulfillment Center", description: "Pick, pack, and ship location for customer orders.", inventorySourceType: "physical", isPhysical: true, allowReceiving: true, allowAudits: true },
  { value: "Retail Store / Pickup", description: "Store inventory available for pickup or local fulfillment.", inventorySourceType: "physical", isPhysical: true, allowReceiving: true, allowAudits: true },
  { value: "Returns Center", description: "Dedicated inspection and disposition location for returned goods.", inventorySourceType: "physical", isPhysical: true, allowReceiving: true, allowAudits: true },
  { value: "Cross-Dock", description: "Short-stay transfer point where inbound stock moves directly outbound.", inventorySourceType: "physical", isPhysical: true, allowReceiving: true, allowAudits: true },
  { value: "Overflow Storage", description: "Supplemental physical storage used when primary capacity is limited.", inventorySourceType: "physical", isPhysical: true, allowReceiving: true, allowAudits: true },
  { value: "3PL / Partner Warehouse", description: "Inventory held by an external logistics or fulfillment partner.", inventorySourceType: "third_party", isPhysical: true, allowReceiving: false, allowAudits: false },
  { value: "Supplier Dropship", description: "Vendor-owned stock shipped directly to the customer; tracking never deducts physical warehouse inventory.", inventorySourceType: "dropship", isPhysical: false, allowReceiving: false, allowAudits: false },
  { value: "Transfer / In Transit", description: "Temporary inventory location for stock moving between facilities.", inventorySourceType: "transfer", isPhysical: false, allowReceiving: false, allowAudits: false },
  { value: "Virtual Supplier Feed", description: "System-managed availability supplied by a vendor's direct feed.", inventorySourceType: "supplier_feed", isPhysical: false, allowReceiving: false, allowAudits: false },
  { value: "Virtual Inventory Source", description: "Non-physical availability used for feeds, dropship, or pooled stock.", inventorySourceType: "virtual", isPhysical: false, allowReceiving: false, allowAudits: false },
] as const

function warehouseTypeOption(value?: string) {
  const key = String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "")
  const aliases: Record<string, string> = { warehouse: "physicalwarehouse", physical: "physicalwarehouse", virtual: "virtualinventorysource", supplierfeed: "virtualsupplierfeed", virtualsuppliernetwork: "virtualsupplierfeed", dropship: "supplierdropship", dropshipwarehouse: "supplierdropship", supplierwarehouse: "supplierdropship", transfer: "transferintransit", transit: "transferintransit", store: "retailstorepickup", retail: "retailstorepickup" }
  const normalized = aliases[key] || key || "physicalwarehouse"
  return WAREHOUSE_TYPE_OPTIONS.find((option) => option.value.toLowerCase().replace(/[^a-z0-9]+/g, "") === normalized) || WAREHOUSE_TYPE_OPTIONS[0]
}

const emptyWarehouseForm = {
  name: "",
  code: "",
  status: "active",
  warehouseType: "Physical Warehouse",
  inventorySourceType: "physical",
  isPhysical: true,
  allowReceiving: true,
  allowAudits: true,
  isSellable: true,
  capacityUnits: 0,
  fulfillmentNetwork: "default",
  dropshipVendorId: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  postalCode: "",
  country: "US",
  isDefaultReceiving: false,
  isDefaultReturns: false,
  requireBinValidation: false,
  notes: "",
}

function WarehouseRegister() {
  const [warehouses, setWarehouses] = useState<WarehouseRegisterRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<WarehouseRegisterRecord | null>(null)
  const [query, setQuery] = useState("")
  const [form, setForm] = useState(emptyWarehouseForm)

  const load = async () => {
    setLoading(true)
    try {
      const result = await api<LiteState>("/api/state?lite=1")
      setWarehouses((result.warehouses || []) as WarehouseRegisterRecord[])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load warehouses.")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  const isVirtual = (warehouse: WarehouseRegisterRecord) => warehouse.isPhysical === false || ["supplier_feed", "dropship", "virtual", "transfer"].includes(String(warehouse.inventorySourceType || "").toLowerCase())
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return warehouses
    return warehouses.filter((warehouse) => [warehouse.name, warehouse.code, warehouse.warehouseType, warehouse.city, warehouse.state].some((value) => String(value || "").toLowerCase().includes(needle)))
  }, [query, warehouses])
  const physicalCount = warehouses.filter((warehouse) => !isVirtual(warehouse)).length
  const activeCount = warehouses.filter((warehouse) => String(warehouse.status || "active").toLowerCase() !== "inactive").length
  const binCount = warehouses.reduce((sum, warehouse) => sum + (Array.isArray(warehouse.bins) ? warehouse.bins.length : 0), 0)

  const openCreate = () => {
    setEditing(null)
    setForm(emptyWarehouseForm)
    setDialogOpen(true)
  }
  const openEdit = (warehouse: WarehouseRegisterRecord) => {
    setEditing(warehouse)
    setForm({
      name: String(warehouse.name || ""),
      code: String(warehouse.code || ""),
      status: String(warehouse.status || "active"),
      warehouseType: String(warehouse.warehouseType || "Physical Warehouse"),
      inventorySourceType: String(warehouse.inventorySourceType || warehouseTypeOption(warehouse.warehouseType).inventorySourceType),
      isPhysical: warehouse.isPhysical !== false,
      allowReceiving: warehouse.allowReceiving !== false,
      allowAudits: warehouse.allowAudits !== false,
      isSellable: warehouse.isSellable !== false,
      capacityUnits: Number(warehouse.capacityUnits || 0),
      fulfillmentNetwork: String(warehouse.fulfillmentNetwork || "default"),
      dropshipVendorId: String(warehouse.dropshipVendorId || warehouse.vendorId || ""),
      addressLine1: String(warehouse.addressLine1 || ""),
      addressLine2: String(warehouse.addressLine2 || ""),
      city: String(warehouse.city || ""),
      state: String(warehouse.state || ""),
      postalCode: String(warehouse.postalCode || ""),
      country: String(warehouse.country || "US"),
      isDefaultReceiving: warehouse.isDefaultReceiving === true,
      isDefaultReturns: warehouse.isDefaultReturns === true,
      requireBinValidation: warehouse.requireBinValidation === true,
      notes: String(warehouse.notes || ""),
    })
    setDialogOpen(true)
  }
  const save = async () => {
    if (!form.name.trim()) { toast.error("Warehouse name is required."); return }
    setSaving(true)
    try {
      const url = editing?.id ? `/api/warehouses/${encodeURIComponent(String(editing.id))}` : "/api/warehouses"
      await api(url, { method: editing?.id ? "PATCH" : "POST", body: JSON.stringify(form) })
      toast.success(editing ? "Warehouse settings saved." : "Warehouse created.")
      setDialogOpen(false)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save warehouse.")
    } finally {
      setSaving(false)
    }
  }
  const address = (warehouse: WarehouseRegisterRecord) => [warehouse.addressLine1, warehouse.city, warehouse.state, warehouse.postalCode].filter(Boolean).join(", ") || "No address recorded"
  const selectWarehouseType = (warehouseType: string) => {
    const option = warehouseTypeOption(warehouseType)
    setForm((current) => ({
      ...current,
      warehouseType: option.value,
      inventorySourceType: option.inventorySourceType,
      isPhysical: option.isPhysical,
      allowReceiving: option.allowReceiving,
      allowAudits: option.allowAudits,
      isSellable: option.inventorySourceType !== "transfer",
      fulfillmentNetwork: option.inventorySourceType === "dropship" ? "supplier" : current.fulfillmentNetwork,
      ...(!option.isPhysical ? { isDefaultReceiving: false, isDefaultReturns: false, requireBinValidation: false } : {}),
    }))
  }

  return <div className="grid gap-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Detail label="All warehouses" value={numberLabel(warehouses.length)} />
      <Detail label="Physical locations" value={numberLabel(physicalCount)} />
      <Detail label="Active locations" value={numberLabel(activeCount)} />
      <Detail label="Configured bins" value={numberLabel(binCount)} />
    </div>
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 border-b">
        <div><CardTitle className="text-base">Warehouse register</CardTitle><CardDescription>Physical facilities and virtual inventory sources are listed separately so supplier-feed availability is never mistaken for stock on the shelf.</CardDescription></div>
        <div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button><Button size="sm" onClick={openCreate}>Add warehouse</Button></div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="border-b p-3"><div className="relative max-w-lg"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search warehouse, code, type, or location" /></div></div>
        <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Warehouse</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Location</TableHead><TableHead>Bins</TableHead><TableHead>Defaults</TableHead><TableHead>Channel mappings</TableHead><TableHead>Updated</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>
          {shown.map((warehouse) => { const virtual = isVirtual(warehouse); const bins = Array.isArray(warehouse.bins) ? warehouse.bins : []; const activeBins = bins.filter((bin) => bin.active !== false).length; return <TableRow key={String(warehouse.id || warehouse.code)}>
            <TableCell><a className="font-medium text-primary hover:underline" href={`/warehouse/warehouses/${encodeURIComponent(String(warehouse.id || ""))}`}>{String(warehouse.name || "Unnamed warehouse")}</a><p className="text-xs text-muted-foreground">{String(warehouse.code || warehouse.id || "No code")}</p></TableCell>
            <TableCell><Badge variant="outline" className={virtual ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300" : "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300"}>{String(warehouse.warehouseType || (virtual ? "Virtual inventory source" : "Physical warehouse"))}</Badge></TableCell>
            <TableCell><Badge variant={String(warehouse.status || "active").toLowerCase() === "inactive" ? "secondary" : "default"}>{String(warehouse.status || "active")}</Badge></TableCell>
            <TableCell><p className="max-w-64 truncate" title={warehouse.managedByVendorFeed ? `${warehouse.vendorName || "Vendor"}: ${(warehouse.sourceFeedNames || []).join(", ")}` : undefined}>{String(warehouse.inventorySourceType || "").toLowerCase() === "supplier_feed" ? (warehouse.managedByVendorFeed ? warehouse.vendorName || "Vendor direct feed" : "DataWarehouse supplier network") : String(warehouse.inventorySourceType || "").toLowerCase() === "transfer" ? "In transit" : virtual ? "Virtual inventory" : address(warehouse)}</p></TableCell>
            <TableCell>{virtual ? <span className="text-muted-foreground">Not applicable</span> : <span>{numberLabel(activeBins)} active / {numberLabel(bins.length)} total</span>}</TableCell>
            <TableCell><div className="flex flex-wrap gap-1">{warehouse.isDefaultReceiving && <Badge variant="secondary">Receiving</Badge>}{warehouse.isDefaultReturns && <Badge variant="secondary">Returns</Badge>}{!warehouse.isDefaultReceiving && !warehouse.isDefaultReturns && <span className="text-muted-foreground">-</span>}</div></TableCell>
            <TableCell><div className="grid gap-1">{(warehouse.channelWarehouseMappings || []).filter((mapping) => mapping.enabled !== false).map((mapping, mappingIndex) => <div key={`${mapping.channel}-${mappingIndex}`}><p className="font-medium">{mapping.channel}: {mapping.localDisplayName || warehouse.name}</p><p className="max-w-52 truncate text-xs text-muted-foreground">{mapping.externalWarehouseName || "Channel warehouse"} · {mapping.externalWarehouseId}</p></div>)}{!(warehouse.channelWarehouseMappings || []).some((mapping) => mapping.enabled !== false) && (warehouse.shopifyLocationName || warehouse.shopifyLocationId ? <div><p>Shopify: {String(warehouse.shopifyLocationName || "location")}</p><p className="max-w-48 truncate text-xs text-muted-foreground">{String(warehouse.shopifyLocationId || "")}</p></div> : <span className="text-muted-foreground">Not mapped</span>)}</div></TableCell>
            <TableCell>{dateLabel(String(warehouse.updatedAt || ""))}</TableCell>
            <TableCell className="text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="outline" title="Warehouse actions"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuLabel>{String(warehouse.name || "Warehouse")}</DropdownMenuLabel><DropdownMenuItem asChild><a href={`/warehouse/warehouses/${encodeURIComponent(String(warehouse.id || ""))}`}><Warehouse className="size-4" /> Open warehouse</a></DropdownMenuItem>{!virtual && <DropdownMenuItem asChild><a href={`/warehouse/warehouses/${encodeURIComponent(String(warehouse.id || ""))}#bins`}><Boxes className="size-4" /> View bins</a></DropdownMenuItem>}<DropdownMenuItem onSelect={() => openEdit(warehouse)}><Pencil className="size-4" /> Quick edit</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell>
          </TableRow> })}
          {!loading && !shown.length && <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted-foreground">No warehouses match this search.</TableCell></TableRow>}
          {loading && <TableRow><TableCell colSpan={9} className="h-28 text-center"><Loader2 className="mx-auto size-5 animate-spin text-primary" /></TableCell></TableRow>}
        </TableBody></Table></div>
      </CardContent>
    </Card>
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>{editing ? "Edit warehouse" : "Add warehouse"}</DialogTitle><DialogDescription>Configure the location identity, operating status, address, and inventory-control defaults.</DialogDescription></DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Warehouse name"><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Staten Island 2" /></Field>
        <Field label="Warehouse code"><Input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} placeholder="SI2" /></Field>
        <Field label="Status"><Select disabled={editing?.managedByVendorFeed === true} value={form.status} onValueChange={(status) => setForm((current) => ({ ...current, status }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent></Select>{editing?.managedByVendorFeed && <p className="mt-1 text-xs text-muted-foreground">Status follows the vendor profile.</p>}</Field>
        <Field label="Warehouse type">
          <Select disabled={String(editing?.inventorySourceType || "").toLowerCase() === "supplier_feed"} value={warehouseTypeOption(form.warehouseType).value} onValueChange={selectWarehouseType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{WAREHOUSE_TYPE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.value}</SelectItem>)}</SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground">{String(editing?.inventorySourceType || "").toLowerCase() === "supplier_feed" ? (editing?.managedByVendorFeed ? `Managed by ${editing.vendorName || "the vendor"}'s direct feed.` : "Managed by the DataWarehouse universal supplier feed.") : warehouseTypeOption(form.warehouseType).description}</p>
        </Field>
        <Field label="Address line 1"><Input value={form.addressLine1} onChange={(event) => setForm((current) => ({ ...current, addressLine1: event.target.value }))} /></Field>
        <Field label="Address line 2"><Input value={form.addressLine2} onChange={(event) => setForm((current) => ({ ...current, addressLine2: event.target.value }))} /></Field>
        <Field label="City"><Input value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="State"><Input value={form.state} onChange={(event) => setForm((current) => ({ ...current, state: event.target.value.toUpperCase() }))} /></Field><Field label="Postal code"><Input value={form.postalCode} onChange={(event) => setForm((current) => ({ ...current, postalCode: event.target.value }))} /></Field></div>
        <div className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:col-span-2 sm:grid-cols-3">
          <div className="flex items-center gap-2"><Switch id="warehouse-default-receiving" disabled={!form.isPhysical} checked={form.isDefaultReceiving} onCheckedChange={(isDefaultReceiving) => setForm((current) => ({ ...current, isDefaultReceiving }))} /><Label htmlFor="warehouse-default-receiving">Default receiving</Label></div>
          <div className="flex items-center gap-2"><Switch id="warehouse-default-returns" disabled={!form.isPhysical} checked={form.isDefaultReturns} onCheckedChange={(isDefaultReturns) => setForm((current) => ({ ...current, isDefaultReturns }))} /><Label htmlFor="warehouse-default-returns">Default returns</Label></div>
          <div className="flex items-center gap-2"><Switch id="warehouse-bin-validation" disabled={!form.isPhysical} checked={form.requireBinValidation} onCheckedChange={(requireBinValidation) => setForm((current) => ({ ...current, requireBinValidation }))} /><Label htmlFor="warehouse-bin-validation">Require bins</Label></div>
        </div>
        <div className="grid gap-4 rounded-md border bg-muted/20 p-3 sm:col-span-2 sm:grid-cols-2">
          <div className="flex items-center gap-2"><Switch id="warehouse-sellable" checked={form.isSellable} onCheckedChange={(isSellable) => setForm((current) => ({ ...current, isSellable }))} /><Label htmlFor="warehouse-sellable">Available for order routing</Label></div>
          <Field label="Capacity (units)"><Input type="number" min="0" value={form.capacityUnits} onChange={(event) => setForm((current) => ({ ...current, capacityUnits: Math.max(0, Number(event.target.value || 0)) }))} /><p className="mt-1 text-xs text-muted-foreground">Use 0 when capacity is not limited.</p></Field>
          <Field label="Fulfillment network"><Input value={form.fulfillmentNetwork} onChange={(event) => setForm((current) => ({ ...current, fulfillmentNetwork: event.target.value }))} placeholder="default" /></Field>
          <Field label="Dropship vendor ID"><Input value={form.dropshipVendorId} onChange={(event) => setForm((current) => ({ ...current, dropshipVendorId: event.target.value }))} placeholder={form.inventorySourceType === "supplier_feed" ? "Required for direct supplier routing" : "Optional"} /></Field>
        </div>
        <div className="sm:col-span-2"><Field label="Notes"><Textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Handling, access, or operational notes" /></Field></div>
      </div>
      <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button disabled={saving || !form.name.trim()} onClick={() => void save()}>{saving && <Loader2 className="size-4 animate-spin" />} Save warehouse</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>
}

function WarehouseBinManager({ fixedWarehouseId = "", onChanged, mobile = false }: { fixedWarehouseId?: string; onChanged?: () => void | Promise<void>; mobile?: boolean } = {}) {
  const [binQuery, setBinQuery] = useState("")
  type Bin = { id?: string; code?: string; name?: string; type?: string; section?: string; aisle?: string; nickname?: string; active?: boolean; isDefault?: boolean; notes?: string }
  type WarehouseRecord = { id?: string; name?: string; code?: string; bins?: Bin[]; requireBinValidation?: boolean }
  const [warehouses, setWarehouses] = useState<WarehouseRecord[]>([])
  const [warehouseId, setWarehouseId] = useState("")
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Bin | null>(null)
  const [view, setView] = useState<"table" | "layout">("table")
  const [form, setForm] = useState({ code: "", name: "", type: "Storage", section: "Storage", aisle: "", nickname: "", notes: "", active: true, isDefault: false })
  const [busy, setBusy] = useState(false)

  const selected = warehouses.find((warehouse) => String(warehouse.id) === warehouseId) || warehouses[0]
  const load = async () => {
    try {
      const result = await api<LiteState>("/api/state?lite=1")
      const rows = (result.warehouses || []).filter(row => !mobile || (row.isPhysical !== false && row.inventorySourceType !== "supplier_feed")) as WarehouseRecord[]
      setWarehouses(rows)
      const requestedWarehouseId = fixedWarehouseId || new URLSearchParams(window.location.search).get("warehouseId") || ""
      setWarehouseId((current) => current || (rows.some((row) => String(row.id) === requestedWarehouseId) ? requestedWarehouseId : String(rows[0]?.id || "")))
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load warehouse locations.") }
  }
  useEffect(() => { void load() }, [fixedWarehouseId])
  const openCreate = () => { setEditing(null); setForm({ code: "", name: "", type: "Storage", section: "Storage", aisle: "", nickname: "", notes: "", active: true, isDefault: !(selected?.bins || []).length }); setDialogOpen(true) }
  const openEdit = (bin: Bin) => { setEditing(bin); setForm({ code: String(bin.code || ""), name: String(bin.name || ""), type: String(bin.type || "Storage"), section: String(bin.section || "Storage"), aisle: String(bin.aisle || ""), nickname: String(bin.nickname || ""), notes: String(bin.notes || ""), active: bin.active !== false, isDefault: bin.isDefault === true }); setDialogOpen(true) }
  const save = async () => {
    if (!selected?.id || !form.code.trim()) { toast.error("A bin code is required."); return }
    setBusy(true)
    try {
      const url = editing?.id ? `/api/warehouses/${encodeURIComponent(String(selected.id))}/bins/${encodeURIComponent(String(editing.id))}` : `/api/warehouses/${encodeURIComponent(String(selected.id))}/bins`
      await api(url, { method: editing?.id ? "PATCH" : "POST", body: JSON.stringify(form) })
      toast.success(editing ? "Bin updated." : "Bin created.")
      setDialogOpen(false)
      await load()
      await onChanged?.()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save bin.") } finally { setBusy(false) }
  }
  const updateBin = async (bin: Bin, changes: Record<string, unknown>) => {
    if (!selected?.id || !bin.id) return
    setBusy(true)
    try { await api(`/api/warehouses/${encodeURIComponent(String(selected.id))}/bins/${encodeURIComponent(String(bin.id))}`, { method: "PATCH", body: JSON.stringify(changes) }); await load(); await onChanged?.(); toast.success("Bin updated.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update bin.") } finally { setBusy(false) }
  }
  const updateWarehouse = async (changes: Record<string, unknown>) => {
    if (!selected?.id) return
    setBusy(true)
    try { await api(`/api/warehouses/${encodeURIComponent(String(selected.id))}`, { method: "PATCH", body: JSON.stringify(changes) }); await load(); await onChanged?.(); toast.success("Warehouse location rules saved.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save warehouse rule.") } finally { setBusy(false) }
  }
  const allBins = selected?.bins || []
  const bins = allBins.filter(bin => !mobile || [bin.code, bin.name, bin.aisle, bin.section].some(value => String(value || "").toLowerCase().includes(binQuery.trim().toLowerCase())))
  const sections = Array.from(new Set(bins.map((bin) => String(bin.section || "Storage").trim() || "Storage"))).sort()
  const binsBySection = sections.map((section) => ({ section, aisles: Array.from(new Set(bins.filter((bin) => String(bin.section || "Storage").trim() === section).map((bin) => String(bin.aisle || "Unassigned").trim() || "Unassigned"))).sort() }))
  return <div className="grid gap-4">
    <Card id="bins"><CardHeader className="flex-row items-start justify-between gap-3"><div><CardTitle className="text-base">Bin master</CardTitle><CardDescription>Use the table for detailed setup, or the bird's-eye view to see the working layout by section and aisle.</CardDescription></div><Button size="sm" onClick={openCreate} disabled={!selected || busy}>Add bin</Button></CardHeader><CardContent className="grid gap-4"><div className="flex flex-wrap items-center gap-3">{!fixedWarehouseId && <Field label="Warehouse"><Select value={String(selected?.id || "")} onValueChange={setWarehouseId}><SelectTrigger className="w-64"><SelectValue placeholder="Select warehouse" /></SelectTrigger><SelectContent>{warehouses.map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{String(warehouse.name || warehouse.code || "Warehouse")}</SelectItem>)}</SelectContent></Select></Field>}<div className={`flex items-center gap-2 ${fixedWarehouseId ? "" : "pt-6"}`}><Switch id={`require-bin-validation-${fixedWarehouseId || "all"}`} checked={selected?.requireBinValidation === true} disabled={!selected || busy} onCheckedChange={(checked) => void updateWarehouse({ requireBinValidation: checked })} /><Label htmlFor={`require-bin-validation-${fixedWarehouseId || "all"}`} className="text-sm">Require active bin on scan and manual receiving</Label></div><Button size="sm" variant="outline" className={fixedWarehouseId ? "" : "mt-6"} disabled={busy} onClick={() => void load()}><RefreshCw className="size-4" /> Refresh</Button></div>
      {selected?.requireBinValidation === true && !bins.filter((bin) => bin.active !== false).length && <Alert><AlertCircle className="size-4" /><AlertTitle>No active bins</AlertTitle><AlertDescription>Add and activate at least one bin before enabling strict bin validation in day-to-day warehouse work.</AlertDescription></Alert>}
      {mobile && <Field label="Scan or search bin"><Input autoComplete="off" value={binQuery} onChange={event => setBinQuery(event.target.value)} placeholder="Bin code, name, or aisle" onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (bins.length === 1) openEdit(bins[0]) } }} /></Field>}
      <Tabs value={view} onValueChange={(value) => setView(value as "table" | "layout")}><TabsList><TabsTrigger value="table">Regular table</TabsTrigger><TabsTrigger value="layout">Bird's-eye view</TabsTrigger></TabsList><TabsContent value="table" className="mt-4"><div className="overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Section / aisle</TableHead><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Status</TableHead><TableHead>Notes</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{bins.map((bin) => <TableRow key={String(bin.id || bin.code)}><TableCell className="font-medium">{String(bin.code || "-")}{bin.isDefault && <Badge variant="secondary" className="ml-2">Default</Badge>}</TableCell><TableCell>{String(bin.section || "Storage")} / {String(bin.aisle || "-")}</TableCell><TableCell>{String(bin.name || "-")}</TableCell><TableCell>{String(bin.type || "Storage")}</TableCell><TableCell><Badge variant={bin.active === false ? "outline" : "secondary"}>{bin.active === false ? "Inactive" : "Active"}</Badge></TableCell><TableCell className="max-w-[200px] truncate">{String(bin.notes || "-")}</TableCell><TableCell className="text-right"><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => openEdit(bin)}>Edit</Button><Button size="sm" variant="ghost" disabled={busy || bin.active === false} onClick={() => void updateBin(bin, { isDefault: true })}>Default</Button><Button size="sm" variant="ghost" disabled={busy || bin.isDefault === true} onClick={() => void updateBin(bin, { active: bin.active === false })}>{bin.active === false ? "Activate" : "Deactivate"}</Button></div></TableCell></TableRow>)}{!bins.length && <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No bins are configured for this warehouse yet.</TableCell></TableRow>}</TableBody></Table></div></TabsContent><TabsContent value="layout" className="mt-4"><div className="grid gap-4 xl:grid-cols-2">{binsBySection.map(({ section, aisles }) => <Card key={section} className="overflow-hidden"><CardHeader className="border-b bg-muted/30 py-3"><CardTitle className="text-sm">{section}</CardTitle><CardDescription>{aisles.length} aisle{aisles.length === 1 ? "" : "s"} / {bins.filter((bin) => String(bin.section || "Storage").trim() === section).length} bins</CardDescription></CardHeader><CardContent className="grid gap-3 p-3">{aisles.map((aisle) => <div key={aisle} className="rounded-md border bg-background p-3"><div className="mb-2 flex items-center justify-between"><p className="text-sm font-medium">Aisle {aisle}</p><Badge variant="outline">{bins.filter((bin) => String(bin.section || "Storage").trim() === section && (String(bin.aisle || "Unassigned").trim() || "Unassigned") === aisle).length} bins</Badge></div><div className="flex flex-wrap gap-2">{bins.filter((bin) => String(bin.section || "Storage").trim() === section && (String(bin.aisle || "Unassigned").trim() || "Unassigned") === aisle).map((bin) => <button type="button" key={String(bin.id || bin.code)} onClick={() => openEdit(bin)} className={`min-w-24 rounded-md border px-3 py-2 text-left text-xs transition-colors hover:bg-muted ${bin.active === false ? "border-dashed text-muted-foreground" : "bg-card"}`}><span className="block font-semibold">{String(bin.code || "-")}</span><span className="block truncate text-muted-foreground">{String(bin.name || bin.type || "Bin")}</span></button>)}</div></div>)}</CardContent></Card>)}{!bins.length && <div className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground xl:col-span-2">Add bins, then assign each one to a section and aisle to create the layout.</div>}</div></TabsContent></Tabs>
    </CardContent></Card>
    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>{editing ? "Edit bin" : "Add bin"}</DialogTitle><DialogDescription>Codes are the scannable location reference. Sections, aisles, and nicknames power the bird's-eye warehouse layout.</DialogDescription></DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bin code"><Input value={form.code} onChange={(event) => setForm((current) => ({ ...current, code: event.target.value.toUpperCase() }))} placeholder="A-01-03" /></Field>
          <Field label="Bin name"><Input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Bay 3, shelf 1" /></Field>
          <Field label="Section"><Input value={form.section} onChange={(event) => setForm((current) => ({ ...current, section: event.target.value }))} placeholder="Storage" /></Field>
          <Field label="Aisle"><Input value={form.aisle} onChange={(event) => setForm((current) => ({ ...current, aisle: event.target.value.toUpperCase() }))} placeholder="1" /></Field>
          <Field label="Location nickname"><Input value={form.nickname} onChange={(event) => setForm((current) => ({ ...current, nickname: event.target.value }))} placeholder="Clearance items" /></Field>
          <Field label="Bin type"><Select value={form.type} onValueChange={(type) => setForm((current) => ({ ...current, type }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Storage", "Picking", "Receiving", "Returns", "Quarantine"].map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent></Select></Field>
          <div className="grid content-end gap-3 sm:col-span-2 sm:grid-cols-2"><div className="flex items-center gap-2"><Switch id="bin-active" checked={form.active} onCheckedChange={(active) => setForm((current) => ({ ...current, active }))} /><Label htmlFor="bin-active">Active</Label></div><div className="flex items-center gap-2"><Switch id="bin-default" checked={form.isDefault} onCheckedChange={(isDefault) => setForm((current) => ({ ...current, isDefault }))} /><Label htmlFor="bin-default">Default bin</Label></div></div>
          <div className="sm:col-span-2"><Field label="Notes"><Textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional handling or access note" /></Field></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button disabled={busy || !form.code.trim()} onClick={() => void save()}>{busy && <Loader2 className="size-4 animate-spin" />} Save bin</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}

function WarehouseDetailPage({ warehouseId }: { warehouseId: string }) {
  const [detail, setDetail] = useState<WarehouseDetailPayload | null>(null)
  const [draft, setDraft] = useState<WarehouseRegisterRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [tab, setTab] = useState(window.location.hash === "#bins" ? "bins" : "overview")
  const [activityQuery, setActivityQuery] = useState("")
  const [activityType, setActivityType] = useState("all")

  const load = async () => {
    setLoading(true)
    try {
      const result = await api<WarehouseDetailPayload>(`/api/warehouses/${encodeURIComponent(warehouseId)}/detail`)
      setDetail(result)
      setDraft(result.warehouse)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load this warehouse.")
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [warehouseId])

  const warehouse = detail?.warehouse
  const supplierFeed = String(warehouse?.inventorySourceType || "").toLowerCase() === "supplier_feed"
  const supplierDropship = String(warehouse?.inventorySourceType || "").toLowerCase() === "dropship"
  const draftSupplierDropship = String(draft?.inventorySourceType || "").toLowerCase() === "dropship"
  const virtualRecord = editing && draft ? draft : warehouse
  const virtual = virtualRecord?.isPhysical === false || ["supplier_feed", "dropship", "virtual", "transfer"].includes(String(virtualRecord?.inventorySourceType || "").toLowerCase())
  const draftVirtual = draft?.isPhysical === false || ["supplier_feed", "dropship", "virtual", "transfer"].includes(String(draft?.inventorySourceType || "").toLowerCase())
  const address = [warehouse?.addressLine1, warehouse?.addressLine2, warehouse?.city, warehouse?.state, warehouse?.postalCode, warehouse?.country].filter(Boolean).join(", ") || (supplierFeed ? "Supplier network" : virtual ? "Non-physical inventory location" : "Address not configured")
  const updateDraft = (field: keyof WarehouseRegisterRecord, value: WarehouseRegisterRecord[keyof WarehouseRegisterRecord]) => setDraft((current) => current ? { ...current, [field]: value } : current)
  const updateChannelWarehouseMapping = (index: number, patch: Partial<NonNullable<WarehouseRegisterRecord["channelWarehouseMappings"]>[number]>) => setDraft((current) => current ? { ...current, channelWarehouseMappings: (current.channelWarehouseMappings || []).map((mapping, mappingIndex) => mappingIndex === index ? { ...mapping, ...patch } : mapping) } : current)
  const addChannelWarehouseMapping = () => setDraft((current) => current ? { ...current, channelWarehouseMappings: [...(current.channelWarehouseMappings || []), { channel: "Temu", localDisplayName: String(current.name || ""), externalWarehouseId: "", externalWarehouseName: "", enabled: true }] } : current)
  const removeChannelWarehouseMapping = (index: number) => setDraft((current) => current ? { ...current, channelWarehouseMappings: (current.channelWarehouseMappings || []).filter((_, mappingIndex) => mappingIndex !== index) } : current)
  const selectWarehouseType = (warehouseType: string) => {
    const option = warehouseTypeOption(warehouseType)
    setDraft((current) => current ? {
      ...current,
      warehouseType: option.value,
      inventorySourceType: option.inventorySourceType,
      isPhysical: option.isPhysical,
      isSellable: option.value !== "Transfer / In Transit",
      allowReceiving: option.allowReceiving,
      allowAudits: option.allowAudits,
      fulfillmentNetwork: option.inventorySourceType === "dropship" ? "supplier" : current.fulfillmentNetwork,
      ...(!option.isPhysical ? { isDefaultReceiving: false, isDefaultReturns: false, requireBinValidation: false } : {}),
    } : current)
  }
  const save = async () => {
    if (!draft?.name?.trim()) { toast.error("Warehouse name is required."); return }
    setSaving(true)
    try {
      await api(`/api/warehouses/${encodeURIComponent(warehouseId)}`, { method: "PATCH", body: JSON.stringify({ ...draft, user: "Warehouse admin" }) })
      toast.success("Warehouse settings saved.")
      setEditing(false)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save warehouse settings.")
    } finally {
      setSaving(false)
    }
  }
  const selectTab = (next: string) => {
    setTab(next)
    window.history.replaceState({}, "", `${window.location.pathname}${next === "bins" ? "#bins" : ""}`)
  }
  const activity = useMemo(() => {
    const needle = activityQuery.trim().toLowerCase()
    return (detail?.activity || []).filter((row) => (activityType === "all" || String(row.type || "update") === activityType) && (!needle || [row.title, row.message, row.reference, row.user, row.source].some((value) => String(value || "").toLowerCase().includes(needle))))
  }, [activityQuery, activityType, detail?.activity])

  if (loading && !warehouse) return <div className="grid min-h-72 place-items-center"><Loader2 className="size-7 animate-spin text-primary" /></div>
  if (!warehouse || !draft) return <Empty className="min-h-72"><EmptyHeader><EmptyMedia variant="icon"><Warehouse className="size-4" /></EmptyMedia><EmptyTitle>Warehouse not found</EmptyTitle><EmptyDescription>This location may have been removed or is no longer available.</EmptyDescription></EmptyHeader><Button variant="outline" asChild><a href="/warehouse/warehouses">Back to warehouses</a></Button></Empty>

  const summary = detail?.summary || {}
  const toggleRows: Array<[keyof WarehouseRegisterRecord, string, string]> = [
    ["isSellable", "Available for order routing", "Allow paid orders to reserve and fulfill inventory from this location."],
    ["allowReceiving", "Receiving enabled", "Allow receipts and PO arrivals into this warehouse."],
    ["allowAudits", "Warehouse audits enabled", "Allow cycle counts and physical inventory audits."],
    ["isDefaultReceiving", "Default receiving location", "Use this warehouse when a receipt has no explicit destination."],
    ["isDefaultReturns", "Default returns location", "Route inspected returns here by default."],
    ["requireAppointment", "Receiving appointment required", "Flag inbound deliveries that need an appointment."],
    ["allowBlindReceipts", "Allow blind receiving", "Permit receipts without displaying expected quantities."],
    ["requireSerialScan", "Require serial scan", "Capture serial numbers for controlled products."],
    ["requirePhotoForDamage", "Damage photo required", "Require evidence when receiving damaged inventory."],
    ["autoRouteReturns", "Auto-route returns", "Apply this warehouse's return routing automatically."],
    ["requireBinValidation", "Require active bin", "Validate the bin during scans and manual receiving."],
    ["shopifyInventoryPushEnabled", "Push inventory to Shopify", "Send this warehouse's available quantity to its mapped Shopify location."],
  ]

  return <div className="grid gap-5">
    <PageHeader eyebrow="Warehouse operations / location" title={String(warehouse.name || "Warehouse")} description={`${String(warehouse.code || warehouse.id || "No code")} / ${String(warehouse.warehouseType || (virtual ? "Virtual inventory source" : "Physical warehouse"))}`} action={<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" asChild><a href="/warehouse/warehouses">Back to warehouses</a></Button>{editing ? <><Button size="sm" variant="outline" onClick={() => { setDraft(warehouse); setEditing(false) }}>Cancel</Button><Button size="sm" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save changes</Button></> : <Button size="sm" onClick={() => { setDraft(warehouse); setEditing(true); setTab("settings") }}><Pencil className="size-4" /> Edit warehouse</Button>}</div>} />
    <div className="flex flex-wrap items-center gap-2"><Badge variant={String(warehouse.status || "active") === "inactive" ? "secondary" : "default"}>{String(warehouse.status || "active")}</Badge>{virtual ? <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">Virtual source</Badge> : <Badge variant="outline" className="border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300">Physical location</Badge>}<Badge variant="outline" className={warehouse.isSellable === false ? "border-slate-400/40 text-muted-foreground" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}>{warehouse.isSellable === false ? "Not sellable" : "Order routing enabled"}</Badge>{warehouse.isDefaultReceiving && <Badge variant="outline">Default receiving</Badge>}{warehouse.isDefaultReturns && <Badge variant="outline">Default returns</Badge>}</div>
    <Tabs value={tab} onValueChange={selectTab}><div className="overflow-x-auto rounded-md border bg-card p-1"><TabsList className="h-auto min-w-max justify-start bg-transparent p-0"><TabsTrigger value="overview">Overview</TabsTrigger>{!virtual && <TabsTrigger value="bins">Bins ({numberLabel(summary.totalBins || 0)})</TabsTrigger>}<TabsTrigger value="settings">Settings</TabsTrigger><TabsTrigger value="activity">Activity ({numberLabel((detail?.activity || []).length)})</TabsTrigger></TabsList></div>
      <TabsContent value="overview" className="mt-4 grid gap-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Detail label="Active bins" value={virtual ? "Not applicable" : `${numberLabel(summary.activeBins || 0)} / ${numberLabel(summary.totalBins || 0)}`} /><Detail label="Audits" value={virtual ? "Not applicable" : `${numberLabel(summary.openAudits || 0)} open`} /><Detail label="Movements" value={numberLabel(summary.movements || 0)} /><Detail label="Order routing" value={warehouse.isSellable === false ? "Excluded" : "Sellable"} /><Detail label="Capacity" value={Number(warehouse.capacityUnits || 0) > 0 ? `${numberLabel(warehouse.capacityUnits)} units` : "Unlimited"} /><Detail label="Network" value={warehouse.fulfillmentNetwork || "default"} /><Detail label="Receiving" value={warehouse.allowReceiving === false ? "Disabled" : "Enabled"} /><Detail label="Inventory sync" value={warehouse.shopifyInventoryPushEnabled ? "Shopify enabled" : "Local only"} /></div>
        {supplierFeed && <Alert><Database className="size-4" /><AlertTitle>Virtual supplier inventory</AlertTitle><AlertDescription>This location represents imported DataWarehouse availability. Physical bins, receiving, and warehouse audits belong to a physical warehouse.</AlertDescription></Alert>}
        {supplierDropship && <Alert><Truck className="size-4" /><AlertTitle>Supplier dropship location</AlertTitle><AlertDescription>The vendor owns this inventory and ships directly to the customer. Recording supplier tracking never reserves or deducts physical DataPlus stock.</AlertDescription></Alert>}
        {virtual && !supplierFeed && !supplierDropship && <Alert><Warehouse className="size-4" /><AlertTitle>{String(warehouse.warehouseType || "Non-physical inventory")}</AlertTitle><AlertDescription>This location tracks inventory without physical receiving, bins, or audits. Use it for virtual availability or stock moving between facilities.</AlertDescription></Alert>}
        <div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">Location and ownership</CardTitle><CardDescription>Who operates this location and where work happens.</CardDescription></CardHeader><CardContent className="grid gap-3 text-sm"><div><p className="text-xs font-medium uppercase text-muted-foreground">Address</p><p>{address}</p></div><Separator /><div className="grid gap-3 sm:grid-cols-2"><div><p className="text-xs font-medium uppercase text-muted-foreground">Manager</p><p>{warehouse.managerName || "Not assigned"}</p></div><div><p className="text-xs font-medium uppercase text-muted-foreground">Contact</p><p>{warehouse.contactName || warehouse.email || warehouse.phone || "Not configured"}</p></div><div><p className="text-xs font-medium uppercase text-muted-foreground">Timezone</p><p>{warehouse.timezone || "America/New_York"}</p></div><div><p className="text-xs font-medium uppercase text-muted-foreground">Operating hours</p><p>{warehouse.operatingHours || "Not configured"}</p></div></div></CardContent></Card><Card><CardHeader><CardTitle className="text-base">Operational rules</CardTitle><CardDescription>Receiving controls and connected inventory destination.</CardDescription></CardHeader><CardContent className="grid gap-3 text-sm"><div className="grid gap-2 sm:grid-cols-2"><Badge variant="outline">{warehouse.requireAppointment ? "Appointment required" : "Open receiving"}</Badge><Badge variant="outline">{warehouse.requireBinValidation ? "Bin validation on" : "Bin validation off"}</Badge><Badge variant="outline">{warehouse.requireSerialScan ? "Serial scan on" : "Serial scan off"}</Badge><Badge variant="outline">{warehouse.requirePhotoForDamage ? "Damage photo required" : "Damage photo optional"}</Badge></div><Separator /><div><p className="text-xs font-medium uppercase text-muted-foreground">Shopify location</p><p>{warehouse.shopifyLocationName || "Not mapped"}</p><p className="text-xs text-muted-foreground">{warehouse.shopifyLocationId || "No location GID"}</p></div><div><p className="text-xs font-medium uppercase text-muted-foreground">Carrier cutoff</p><p>{warehouse.carrierCutoffTime || "Not configured"}</p></div></CardContent></Card></div>
        <Card><CardHeader className="flex-row items-center justify-between"><div><CardTitle className="text-base">Recent activity</CardTitle><CardDescription>Latest inventory, receiving, audit, bin, and settings changes.</CardDescription></div><Button size="sm" variant="outline" onClick={() => setTab("activity")}>View full log</Button></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Event</TableHead><TableHead>Details</TableHead><TableHead>Source</TableHead></TableRow></TableHeader><TableBody>{(detail?.activity || []).slice(0, 8).map((row) => <TableRow key={String(row.id)}><TableCell className="whitespace-nowrap">{dateLabel(row.createdAt)}</TableCell><TableCell className="font-medium">{row.title || "Warehouse updated"}</TableCell><TableCell>{row.message || "-"}</TableCell><TableCell><Badge variant="outline">{row.source || "Warehouse"}</Badge></TableCell></TableRow>)}{!(detail?.activity || []).length && <TableRow><TableCell colSpan={4} className="h-24 text-center text-muted-foreground">Warehouse activity will appear here as work is completed.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
      </TabsContent>
      {!virtual && <TabsContent value="bins" className="mt-4"><WarehouseBinManager fixedWarehouseId={warehouseId} onChanged={load} /></TabsContent>}
      <TabsContent value="settings" className="mt-4 grid gap-4">
        {!editing && <Alert><LockKeyhole className="size-4" /><AlertTitle>Settings are locked</AlertTitle><AlertDescription>Select Edit warehouse to change location rules. Every saved change is retained in Activity.</AlertDescription></Alert>}
        <Card>
          <CardHeader><CardTitle className="text-base">Identity and address</CardTitle><CardDescription>Core location identity, operating state, and contact information.</CardDescription></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Warehouse name"><Input disabled={!editing} value={String(draft.name || "")} onChange={(event) => updateDraft("name", event.target.value)} /></Field>
            <Field label="Code"><Input disabled={!editing} value={String(draft.code || "")} onChange={(event) => updateDraft("code", event.target.value.toUpperCase())} /></Field>
            <Field label="Status"><Select disabled={!editing || warehouse?.managedByVendorFeed === true} value={String(draft.status || "active")} onValueChange={(value) => updateDraft("status", value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent></Select>{warehouse?.managedByVendorFeed && <p className="mt-1 text-xs text-muted-foreground">Status follows the vendor profile.</p>}</Field>
            <Field label="Warehouse type">
              <Select disabled={!editing || supplierFeed} value={warehouseTypeOption(draft.warehouseType).value} onValueChange={selectWarehouseType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{WAREHOUSE_TYPE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.value}</SelectItem>)}</SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">{supplierFeed ? (warehouse?.managedByVendorFeed ? `Managed by ${warehouse.vendorName || "the vendor"}'s direct feed. Contributing feed${(warehouse.sourceFeedNames || []).length === 1 ? "" : "s"}: ${(warehouse.sourceFeedNames || []).join(", ") || "configured vendor feed"}.` : "Managed by the DataWarehouse universal supplier feed.") : warehouseTypeOption(draft.warehouseType).description}</p>
            </Field>
            <Field label="Manager"><Input disabled={!editing || draftVirtual} value={String(draft.managerName || "")} onChange={(event) => updateDraft("managerName", event.target.value)} /></Field>
            <Field label="Primary contact"><Input disabled={!editing || draftVirtual} value={String(draft.contactName || "")} onChange={(event) => updateDraft("contactName", event.target.value)} /></Field>
            <Field label="Phone"><Input disabled={!editing || draftVirtual} value={String(draft.phone || "")} onChange={(event) => updateDraft("phone", event.target.value)} /></Field>
            <Field label="Email"><Input disabled={!editing || draftVirtual} value={String(draft.email || "")} onChange={(event) => updateDraft("email", event.target.value)} /></Field>
            <Field label="Timezone"><Input disabled={!editing} value={String(draft.timezone || "America/New_York")} onChange={(event) => updateDraft("timezone", event.target.value)} /></Field>
            <Field label="Address line 1"><Input disabled={!editing || draftVirtual} value={String(draft.addressLine1 || "")} onChange={(event) => updateDraft("addressLine1", event.target.value)} /></Field>
            <Field label="Address line 2"><Input disabled={!editing || draftVirtual} value={String(draft.addressLine2 || "")} onChange={(event) => updateDraft("addressLine2", event.target.value)} /></Field>
            <Field label="City"><Input disabled={!editing || draftVirtual} value={String(draft.city || "")} onChange={(event) => updateDraft("city", event.target.value)} /></Field>
            <Field label="State"><Input disabled={!editing || draftVirtual} value={String(draft.state || "")} onChange={(event) => updateDraft("state", event.target.value.toUpperCase())} /></Field>
            <Field label="Postal code"><Input disabled={!editing || draftVirtual} value={String(draft.postalCode || "")} onChange={(event) => updateDraft("postalCode", event.target.value)} /></Field>
            <Field label="Country"><Input disabled={!editing || draftVirtual} value={String(draft.country || "US")} onChange={(event) => updateDraft("country", event.target.value.toUpperCase())} /></Field>
          </CardContent>
        </Card>
        <Card><CardHeader><CardTitle className="text-base">Operations and controls</CardTitle><CardDescription>Settings used by routing, receiving, returns, audits, scanning, and connected channels.</CardDescription></CardHeader><CardContent className="grid gap-4"><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"><Field label="Operating hours"><Input disabled={!editing || virtual} value={String(draft.operatingHours || "")} onChange={(event) => updateDraft("operatingHours", event.target.value)} placeholder="Mon-Fri 08:00-17:00" /></Field><Field label="Carrier cutoff"><Input disabled={!editing || virtual} type="time" value={String(draft.carrierCutoffTime || "")} onChange={(event) => updateDraft("carrierCutoffTime", event.target.value)} /></Field><Field label="Capacity units"><Input disabled={!editing} type="number" min="0" value={String(draft.capacityUnits || 0)} onChange={(event) => updateDraft("capacityUnits", Number(event.target.value || 0))} /><p className="mt-1 text-xs text-muted-foreground">Use 0 for unlimited capacity.</p></Field><Field label="Fulfillment network"><Input disabled={!editing} value={String(draft.fulfillmentNetwork || "default")} onChange={(event) => updateDraft("fulfillmentNetwork", event.target.value)} placeholder="default" /></Field><Field label="Dropship vendor ID"><Input disabled={!editing || !(supplierFeed || draftSupplierDropship)} value={String(draft.dropshipVendorId || "")} onChange={(event) => updateDraft("dropshipVendorId", event.target.value)} placeholder="Vendor profile ID" /></Field><Field label="Shopify location name"><Input disabled={!editing} value={String(draft.shopifyLocationName || "")} onChange={(event) => updateDraft("shopifyLocationName", event.target.value)} /></Field><div className="sm:col-span-2 lg:col-span-3"><Field label="Shopify location GID"><Input disabled={!editing} value={String(draft.shopifyLocationId || "")} onChange={(event) => updateDraft("shopifyLocationId", event.target.value)} placeholder="gid://shopify/Location/..." /></Field></div></div><div className="grid gap-3 md:grid-cols-2">{toggleRows.map(([field, title, description]) => <div key={String(field)} className={cn("flex items-start justify-between gap-4 rounded-md border p-3", !editing && "bg-muted/20")}><div><Label htmlFor={`warehouse-${String(field)}`}>{title}</Label><p className="mt-1 text-xs text-muted-foreground">{description}</p></div><Switch id={`warehouse-${String(field)}`} disabled={!editing || (virtual && !["shopifyInventoryPushEnabled", "isSellable"].includes(String(field)))} checked={draft[field] === true} onCheckedChange={(checked) => updateDraft(field, checked)} /></div>)}</div><Field label="Receiving instructions"><Textarea disabled={!editing || virtual} value={String(draft.receivingInstructions || "")} onChange={(event) => updateDraft("receivingInstructions", event.target.value)} /></Field><Field label="Warehouse notes"><Textarea disabled={!editing} value={String(draft.notes || "")} onChange={(event) => updateDraft("notes", event.target.value)} /></Field></CardContent></Card>
        <Card><CardHeader className="flex-row items-start justify-between gap-3"><div><CardTitle className="text-base">Channel warehouse mappings</CardTitle><CardDescription>Show how this DataPlus warehouse is named and identified in each marketplace.</CardDescription></div>{editing && <Button size="sm" variant="outline" onClick={addChannelWarehouseMapping}><Plus className="size-4" /> Add mapping</Button>}</CardHeader><CardContent className="grid gap-3">{(draft.channelWarehouseMappings || []).map((mapping, index) => <div key={`${mapping.channel}-${index}`} className="grid gap-3 rounded-md border p-3 md:grid-cols-[150px_minmax(140px,1fr)_minmax(140px,1fr)_minmax(220px,1.5fr)_auto]"><Field label="Channel"><Select disabled={!editing} value={mapping.channel || "Temu"} onValueChange={(channel) => updateChannelWarehouseMapping(index, { channel })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Temu">Temu</SelectItem><SelectItem value="Shopify">Shopify</SelectItem><SelectItem value="eBay">eBay</SelectItem><SelectItem value="Walmart">Walmart</SelectItem></SelectContent></Select></Field><Field label="DataPlus display"><Input disabled={!editing} value={mapping.localDisplayName || ""} onChange={(event) => updateChannelWarehouseMapping(index, { localDisplayName: event.target.value })} placeholder={String(draft.name || "Warehouse")} /></Field><Field label="Channel display"><Input disabled={!editing} value={mapping.externalWarehouseName || ""} onChange={(event) => updateChannelWarehouseMapping(index, { externalWarehouseName: event.target.value })} placeholder="Marketplace warehouse name" /></Field><Field label="Channel warehouse ID"><Input disabled={!editing} value={mapping.externalWarehouseId || ""} onChange={(event) => updateChannelWarehouseMapping(index, { externalWarehouseId: event.target.value })} placeholder="Marketplace warehouse ID" /></Field><div className="flex items-end gap-2 pb-0.5"><Switch disabled={!editing} checked={mapping.enabled !== false} onCheckedChange={(enabled) => updateChannelWarehouseMapping(index, { enabled })} aria-label={`Enable ${mapping.channel} mapping`} />{editing && <Button size="icon" variant="ghost" title="Remove mapping" onClick={() => removeChannelWarehouseMapping(index)}><Trash2 className="size-4" /></Button>}</div></div>)}{!(draft.channelWarehouseMappings || []).length && <div className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">This warehouse is not mapped to a channel warehouse.</div>}{editing && <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => { setDraft(warehouse); setEditing(false) }}>Cancel</Button><Button disabled={saving} onClick={() => void save()}>{saving && <Loader2 className="size-4 animate-spin" />} Save changes</Button></div>}</CardContent></Card>
      </TabsContent>
      <TabsContent value="activity" className="mt-4"><Card><CardHeader className="gap-3 border-b"><div><CardTitle className="text-base">Warehouse activity</CardTitle><CardDescription>A combined log of settings, bins, inventory movements, receiving, and audits for this location.</CardDescription></div><div className="flex flex-col gap-2 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={activityQuery} onChange={(event) => setActivityQuery(event.target.value)} placeholder="Search event, SKU, reference, source, or user" /></div><Select value={activityType} onValueChange={setActivityType}><SelectTrigger className="sm:w-52"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All activity</SelectItem><SelectItem value="settings">Settings</SelectItem><SelectItem value="bin">Bins</SelectItem><SelectItem value="inventory">Inventory</SelectItem><SelectItem value="receipt">Receiving</SelectItem><SelectItem value="audit">Audits</SelectItem></SelectContent></Select><Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button></div></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Event</TableHead><TableHead>Details</TableHead><TableHead>Source</TableHead><TableHead>Reference</TableHead><TableHead>User</TableHead></TableRow></TableHeader><TableBody>{activity.map((row) => <TableRow key={String(row.id)}><TableCell className="whitespace-nowrap">{dateLabel(row.createdAt)}</TableCell><TableCell><div className="flex items-center gap-2">{row.type === "inventory" ? <Activity className="size-4 text-blue-600" /> : row.type === "audit" ? <CheckCircle2 className="size-4 text-emerald-600" /> : row.type === "receipt" ? <Truck className="size-4 text-violet-600" /> : row.type === "bin" ? <Boxes className="size-4 text-amber-600" /> : <Settings className="size-4 text-muted-foreground" />}<span className="font-medium">{row.title || "Warehouse updated"}</span></div></TableCell><TableCell className="min-w-72">{row.message || "-"}</TableCell><TableCell><Badge variant="outline">{row.source || "Warehouse"}</Badge></TableCell><TableCell>{row.reference || "-"}</TableCell><TableCell>{row.user || "System"}</TableCell></TableRow>)}{!activity.length && <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">No warehouse activity matches this view.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card></TabsContent>
    </Tabs>
  </div>
}

type ReceivingPurchaseOrder = {
  id: string
  poNumber?: string
  status?: string
  supplier?: string
  warehouseName?: string
  expectedAt?: string
}

function InboundReceivingLauncher({ mobile = false, operatorName = "Warehouse" }: { mobile?: boolean; operatorName?: string } = {}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<"purchase_order" | "manual">("purchase_order")
  const [warehouses, setWarehouses] = useState<Array<{ id?: string; name?: string }>>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [warehouseId, setWarehouseId] = useState("")
  const [vendorId, setVendorId] = useState("")
  const [vendorOpen, setVendorOpen] = useState(false)
  const [externalPoNumber, setExternalPoNumber] = useState("")
  const [query, setQuery] = useState("")
  const [purchaseOrders, setPurchaseOrders] = useState<ReceivingPurchaseOrder[]>([])
  const [selectedPo, setSelectedPo] = useState<ReceivingPurchaseOrder | null>(null)
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)

  const loadReferenceData = async () => {
    try {
      const state = await api<LiteState>("/api/state?lite=1")
      const physical = (state.warehouses || []).filter((item) => item.isPhysical !== false && item.inventorySourceType !== "supplier_feed" && item.allowReceiving !== false)
      setWarehouses(physical as typeof warehouses)
      setWarehouseId((current) => current || String(physical.find((item) => item.isDefaultReceiving)?.id || physical[0]?.id || ""))
      setVendors((state.vendors || []).filter((vendor) => {
        const status = String(vendor.status || "active").trim().toLowerCase()
        return !["retired", "deleted"].includes(status) && !vendor.retirement?.retiredAt
      }).sort((left, right) => String(left.name || "").localeCompare(String(right.name || ""), undefined, { sensitivity: "base" })))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load receiving options.")
    }
  }

  const show = (nextMode: "purchase_order" | "manual") => {
    setMode(nextMode)
    setSelectedPo(null)
    setPurchaseOrders([])
    setVendorOpen(false)
    setOpen(true)
    void loadReferenceData()
  }

  const searchPurchaseOrders = async () => {
    if (!query.trim()) return
    setSearching(true)
    try {
      const result = await api<{ purchaseOrders?: ReceivingPurchaseOrder[] }>(`/api/purchasing/receiving-search?q=${encodeURIComponent(query.trim())}`)
      setPurchaseOrders(result.purchaseOrders || [])
      if (!(result.purchaseOrders || []).length) toast.info("No open purchase orders matched that search.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to search purchase orders.")
    } finally {
      setSearching(false)
    }
  }

  const startReceiving = async () => {
    const vendor = vendors.find((row) => row.id === vendorId)
    if (!warehouseId || (mode === "purchase_order" ? !selectedPo : !vendor || !externalPoNumber.trim())) return
    setLoading(true)
    try {
      const result = await api<{ audit?: Record<string, unknown>; message?: string }>("/api/warehouse-audits", {
        method: "POST",
        body: JSON.stringify({
          warehouseId,
          reason: mode === "purchase_order" ? "purchase_order_receipt" : "external_po_receipt",
          purchaseOrderId: selectedPo?.id || "",
          supplierId: mode === "manual" ? vendor?.id || "" : "",
          supplierName: mode === "manual" ? vendor?.name || "" : "",
          externalPurchaseOrderNumber: mode === "manual" ? externalPoNumber.trim() : "",
          user: operatorName,
        }),
      })
      if (!result.audit?.id) throw new Error("The inbound receiving workspace could not be created.")
      toast.success(result.message || "Inbound receiving started.")
      window.location.assign(`${mobile ? "/warehouse/mobile/audits" : "/warehouse/audits"}/${encodeURIComponent(String(result.audit.id))}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to start inbound receiving.")
    } finally {
      setLoading(false)
    }
  }

  return <>
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Receive inbound shipment</CardTitle>
        <CardDescription>Scan every item into one receiving record, photograph or upload the packing slip, and compare the document to the physical delivery before inventory is posted.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <button type="button" className="flex min-h-28 items-start gap-3 rounded-md border p-4 text-left transition-colors hover:bg-muted/50" onClick={() => show("purchase_order")}>
          <FileText className="mt-0.5 size-5 shrink-0 text-primary" />
          <span><span className="block font-medium">Receive existing PO</span><span className="mt-1 block text-sm text-muted-foreground">Find an open DataPlus purchase order, scan the delivery, and update the PO receipt history.</span></span>
        </button>
        <button type="button" className="flex min-h-28 items-start gap-3 rounded-md border p-4 text-left transition-colors hover:bg-muted/50" onClick={() => show("manual")}>
          <ScanBarcode className="mt-0.5 size-5 shrink-0 text-primary" />
          <span><span className="block font-medium">Receive external or manual PO</span><span className="mt-1 block text-sm text-muted-foreground">Receive a shipment ordered outside DataPlus while preserving its supplier, external PO, scans, and packing slips.</span></span>
        </button>
      </CardContent>
    </Card>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[100dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{mode === "purchase_order" ? "Receive existing purchase order" : "Receive external inbound shipment"}</DialogTitle>
          <DialogDescription>{mode === "purchase_order" ? "Choose the DataPlus PO and receiving warehouse. Its open lines become the expected quantities for the scan." : "Record the supplier and source-system PO number, then scan the entire shipment."}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Tabs value={mode} onValueChange={(value) => { setMode(value as typeof mode); setSelectedPo(null) }}>
            <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="purchase_order">Existing PO</TabsTrigger><TabsTrigger value="manual">Manual / external</TabsTrigger></TabsList>
          </Tabs>
          {mode === "purchase_order" ? <div className="grid gap-3">
            <Field label="Find open PO"><div className="flex gap-2"><Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchPurchaseOrders() } }} placeholder="PO number, supplier, or warehouse" /><Button type="button" variant="outline" disabled={searching || !query.trim()} onClick={() => void searchPurchaseOrders()}>{searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Search</Button></div></Field>
            {purchaseOrders.length > 0 && <div className="max-h-64 overflow-y-auto rounded-md border divide-y">{purchaseOrders.map((po) => <button type="button" key={po.id} className={cn("flex w-full items-start justify-between gap-3 p-3 text-left hover:bg-muted/50", selectedPo?.id === po.id && "bg-primary/10 ring-1 ring-inset ring-primary")} onClick={() => { setSelectedPo(po); const warehouse = warehouses.find((row) => String(row.name || "").toLowerCase() === String(po.warehouseName || "").toLowerCase()); if (warehouse?.id) setWarehouseId(String(warehouse.id)) }}><span className="min-w-0"><span className="block font-medium">{po.poNumber || po.id}</span><span className="block truncate text-sm text-muted-foreground">{po.supplier || "Supplier not recorded"} · {po.warehouseName || "Warehouse not assigned"}</span></span><Badge variant="outline" className="shrink-0">{String(po.status || "open").replace(/_/g, " ")}</Badge></button>)}</div>}
          </div> : <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Supplier"><Popover open={vendorOpen} onOpenChange={setVendorOpen}><PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-expanded={vendorOpen} className="w-full justify-between font-normal"><span className="truncate">{(() => { const vendor = vendors.find((row) => row.id === vendorId); return vendor ? `${vendor.name}${vendor.code ? ` (${vendor.code})` : ""}` : "Search supplier" })()}</span><ChevronDown className="size-4 shrink-0 opacity-60" /></Button></PopoverTrigger><PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0"><Command><CommandInput placeholder="Search supplier..." /><CommandList className="max-h-72"><CommandEmpty>No supplier found.</CommandEmpty><CommandGroup>{vendors.map((vendor) => { const status = String(vendor.status || "active").trim().toLowerCase(); return <CommandItem key={vendor.id} value={`${vendor.name || ""} ${vendor.code || ""}`} onSelect={() => { setVendorId(vendor.id); setVendorOpen(false) }}><CheckCircle2 className={cn("size-4 shrink-0", vendor.id === vendorId ? "opacity-100" : "opacity-0")} /><span className="min-w-0 flex-1 truncate">{vendor.name}{vendor.code ? ` (${vendor.code})` : ""}</span>{status !== "active" && <Badge variant="outline" className="shrink-0 capitalize">{status}</Badge>}</CommandItem> })}</CommandGroup></CommandList></Command></PopoverContent></Popover></Field>
            <Field label="External PO number"><Input value={externalPoNumber} onChange={(event) => setExternalPoNumber(event.target.value)} placeholder="PO number from the other system" /></Field>
          </div>}
          <Field label="Receiving warehouse"><Select value={warehouseId} onValueChange={setWarehouseId}><SelectTrigger><SelectValue placeholder="Select physical warehouse" /></SelectTrigger><SelectContent>{warehouses.map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{String(warehouse.name || "Warehouse")}</SelectItem>)}</SelectContent></Select></Field>
          <Alert><Camera className="size-4" /><AlertTitle>Packing slip required</AlertTitle><AlertDescription>The receiving workspace will ask for a packing-slip photo or upload and compare extracted lines with the scanned items before final posting.</AlertDescription></Alert>
        </div>
        <DialogFooter><Button variant="outline" disabled={loading} onClick={() => setOpen(false)}>Cancel</Button><Button disabled={loading || !warehouseId || (mode === "purchase_order" ? !selectedPo : !vendorId || !externalPoNumber.trim())} onClick={() => void startReceiving()}>{loading ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />} Start receiving</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}

function WarehouseWorkspace() {
  const path = window.location.pathname.replace(/\/+$/, "")
  if (path.startsWith("/warehouse/audits/")) return <WarehouseAuditDetailPage />
  const warehouseDetailMatch = path.match(/^\/warehouse\/warehouses\/([^/]+)$/)
  if (warehouseDetailMatch) return <WarehouseDetailPage warehouseId={decodeURIComponent(warehouseDetailMatch[1])} />
  const [tab, setTab] = useState(path.endsWith("/audits") ? "audits" : path.endsWith("/bins") ? "bins" : path.endsWith("/receiving") ? "receiving" : "warehouses")
  const selectTab = (next: string) => {
    setTab(next)
    window.history.replaceState({}, "", next === "audits" ? "/warehouse/audits" : next === "bins" ? "/warehouse/bins" : next === "receiving" ? "/warehouse/receiving" : "/warehouse/warehouses")
  }
  return <div className="grid min-w-0 gap-5"><PageHeader eyebrow="Warehouse operations" title="Warehouse" description="See every location, receive inventory, manage counts, and keep an auditable record of physical-stock changes." /><Tabs className="min-w-0" value={tab} onValueChange={selectTab}><div className="overflow-x-auto rounded-md border bg-card p-1"><TabsList className="h-auto min-w-max justify-start bg-transparent p-0"><TabsTrigger value="warehouses">Warehouses</TabsTrigger><TabsTrigger value="receiving">Receiving</TabsTrigger><TabsTrigger value="audits">Warehouse audits</TabsTrigger><TabsTrigger value="bins">Bins</TabsTrigger></TabsList></div><TabsContent value="warehouses" className="mt-4 min-w-0"><WarehouseRegister /></TabsContent><TabsContent value="receiving" className="mt-4 grid min-w-0 gap-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"><Detail label="Inbound shipment" value="Scan the full delivery and verify its packing slip" /><Detail label="PO receipts" value="Receive against an existing DataPlus PO" /><Detail label="Return receipts" value="Inspect and restock from the order" /></div><InboundReceivingLauncher /><ManualReceivingPanel /></TabsContent><TabsContent value="audits" className="mt-4 grid min-w-0 gap-4"><WarehouseAuditHistory /><WarehouseAuditPanel createOnly /></TabsContent><TabsContent value="bins" className="mt-4 min-w-0"><WarehouseBinManager /></TabsContent></Tabs></div>
}

function WarehouseAuditDetailPage() {
  const auditId = decodeURIComponent((window.location.pathname.split("/")[3] || "").trim())
  return <div className="grid gap-5"><PageHeader eyebrow="Warehouse operations / audit" title="Warehouse audit" description="A focused counting workspace for this warehouse and audit team." action={<Button size="sm" variant="outline" asChild><a href="/warehouse/audits">Back to audit register</a></Button>} /><WarehouseAuditPanel auditId={auditId} /></div>
}

type WarehouseAuditSort = "newest" | "oldest" | "identifier";
function sortWarehouseAuditRows(rows: Array<Record<string, unknown>>, sort: WarehouseAuditSort, items = false) {
  const timestamp = (row: Record<string, unknown>) => {
    const value = Date.parse(String(items ? row.firstScannedAt || row.scannedAt || row.createdAt || "" : row.createdAt || ""));
    return Number.isFinite(value) ? value : 0;
  };
  return rows.map((row, index) => ({ row, index })).sort((a, b) => {
    if (sort === "identifier") return String(a.row.sku || a.row.barcode || a.row.auditNumber || "").localeCompare(String(b.row.sku || b.row.barcode || b.row.auditNumber || ""), undefined, { numeric: true, sensitivity: "base" });
    const difference = timestamp(a.row) - timestamp(b.row);
    // Scan rows are appended, while the audit API returns newest audits first.
    const tie = items ? a.index - b.index : b.index - a.index;
    return (sort === "newest" ? -1 : 1) * (difference || tie);
  }).map(({ row }) => row);
}
function WarehouseAuditSortControl({ value, onChange, items = false }: { value: WarehouseAuditSort; onChange: (value: WarehouseAuditSort) => void; items?: boolean }) {
  return <Select value={value} onValueChange={(next) => onChange(next as WarehouseAuditSort)}><SelectTrigger aria-label={items ? "Sort audit items" : "Sort audits"} className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="newest">Latest first</SelectItem><SelectItem value="oldest">Oldest first</SelectItem><SelectItem value="identifier">{items ? "SKU / UPC A–Z" : "Audit ID A–Z"}</SelectItem></SelectContent></Select>;
}

function WarehouseAuditHistory({ mobile = false }: { mobile?: boolean } = {}) {
  const [audits, setAudits] = useState<Array<Record<string, unknown>>>([])
  const [sort, setSort] = useState<WarehouseAuditSort>("newest")
  const sortedAudits = sortWarehouseAuditRows(audits, sort)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [actionAudit, setActionAudit] = useState<Record<string, unknown> | null>(null)
  const [action, setAction] = useState<"lock" | "delete">("lock")
  const [pin, setPin] = useState("")
  const [adminUserId, setAdminUserId] = useState("")
  const [acting, setActing] = useState(false)
  const load = async () => { setLoading(true); try { const params = new URLSearchParams({ summary: "1", page: String(page), pageSize: "25", sort }); const [result, state] = await Promise.all([api<{ audits?: Array<Record<string, unknown>>; total?: number; totalPages?: number }>(`/api/warehouse-audits?${params.toString()}`), api<LiteState>("/api/state?lite=1")]); setAudits(result.audits || []); setTotal(Number(result.total || 0)); setTotalPages(Math.max(1, Number(result.totalPages || 1))); setAdminUserId(String(state.systemSettings?.activeSystemUserId || "")) } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load warehouse audits.") } finally { setLoading(false) } }
  useEffect(() => { void load() }, [page, sort])
  const openAction = (audit: Record<string, unknown>, nextAction: "lock" | "delete") => { setActionAudit(audit); setAction(nextAction); setPin("") }
  const confirmAction = async () => { if (!actionAudit || !pin.trim()) return; setActing(true); try { const path = action === "lock" ? `/api/warehouse-audits/${encodeURIComponent(String(actionAudit.id))}/lock` : `/api/warehouse-audits/${encodeURIComponent(String(actionAudit.id))}`; const result = await api<{ message?: string }>(path, { method: action === "lock" ? "POST" : "DELETE", body: JSON.stringify({ adminPin: pin, adminUserId }) }); toast.success(result.message || `Audit ${action}ed.`); setActionAudit(null); await load() } catch (error) { toast.error(error instanceof Error ? error.message : `Unable to ${action} audit.`) } finally { setActing(false) } }
  const auditStatus = (audit: Record<string, unknown>) => {
    const status = String(audit.status || "unknown")
    return <Badge variant={status === "in_progress" ? "info" : status === "pending_review" ? "warning" : status === "completed" ? "success" : status === "locked" ? "destructive" : "outline"}>{status === "in_progress" ? "In progress" : status === "pending_review" ? "Review" : status === "completed" ? "Completed" : status === "locked" ? "Locked" : status.replace(/_/g, " ")}</Badge>
  }
  const auditHref = (audit: Record<string, unknown>) => `${mobile ? "/warehouse/mobile/audits" : "/warehouse/audits"}/${encodeURIComponent(String(audit.id))}`
  const auditActions = (audit: Record<string, unknown>) => <div className="flex shrink-0 items-center justify-end gap-1">
    <DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label={`More options for ${String(audit.auditNumber || "audit")}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild><a href={auditHref(audit)}><Eye className="size-4" />Open audit</a></DropdownMenuItem>
        <DropdownMenuItem asChild><a href={`/api/warehouse-audits/${encodeURIComponent(String(audit.id))}/export`}><FileDown className="size-4" />Export CSV</a></DropdownMenuItem>
        <DropdownMenuItem disabled={audit.status === "locked" || audit.status === "completed"} onClick={() => openAction(audit, "lock")}><LockKeyhole className="size-4" />Lock audit</DropdownMenuItem>
        <DropdownMenuItem className="text-destructive" disabled={audit.status === "completed"} onClick={() => openAction(audit, "delete")}><Trash2 className="size-4" />Delete audit</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
  return <><Card><CardHeader className="audit-register-header flex flex-row items-center justify-between gap-3"><div><CardTitle className="text-base">Audit register</CardTitle><CardDescription>{numberLabel(total)} audits</CardDescription></div><Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button></CardHeader><CardContent className="p-0"><div className="px-4 pb-2"><WarehouseAuditSortControl value={sort} onChange={(next) => { setPage(1); setSort(next) }} /></div><div className={cn("divide-y", !mobile && "sm:hidden")} data-testid="audit-register-cards">{sortedAudits.map(audit => <article key={String(audit.id)} className="space-y-2 px-4 py-3">
    <div className="flex items-center justify-between gap-2"><a className="inline-flex min-h-11 min-w-0 items-center truncate font-semibold text-primary underline-offset-4 hover:underline" href={auditHref(audit)}>{String(audit.auditNumber || "Audit")}</a>{auditStatus(audit)}</div>
    <p className="truncate text-xs text-muted-foreground">Created by {String(audit.createdBy || "Unknown")}</p><p className="truncate text-sm text-muted-foreground">{String(audit.warehouseName || "Warehouse")}</p>
    <div className="flex items-center justify-between gap-2"><p className="min-w-0 text-xs"><span className="font-medium">{numberLabel(Number(audit.lineCount ?? (Array.isArray(audit.lines) ? audit.lines.length : 0)))}</span> counted <span className="px-1 text-muted-foreground">·</span> <span className={Number(audit.unknownBarcodeCount ?? (Array.isArray(audit.unknownBarcodes) ? audit.unknownBarcodes.length : 0)) ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground"}>{numberLabel(Number(audit.unknownBarcodeCount ?? (Array.isArray(audit.unknownBarcodes) ? audit.unknownBarcodes.length : 0)))} unknown</span></p>{auditActions(audit)}</div>
    <Collapsible><CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground"><ChevronDown className="size-3" />Details</CollapsibleTrigger><CollapsibleContent><dl className="grid grid-cols-2 gap-x-3 gap-y-2 pt-2 text-xs"><div><dt className="text-muted-foreground">Counter</dt><dd className="break-words">{String(audit.createdBy || "-")}</dd></div><div><dt className="text-muted-foreground">Reviewer</dt><dd className="break-words">{String(audit.reviewer || "Unassigned")}</dd></div><div><dt className="text-muted-foreground">Started</dt><dd>{dateLabel(String(audit.createdAt || ""))}</dd></div><div><dt className="text-muted-foreground">Completed</dt><dd>{audit.completedAt ? dateLabel(String(audit.completedAt)) : "-"}</dd></div></dl></CollapsibleContent></Collapsible>
  </article>)}{!audits.length && <p className="p-4 text-sm text-muted-foreground">{loading ? "Loading audits..." : "No warehouse audits have been created yet."}</p>}</div><div className={cn("hidden overflow-x-auto", !mobile && "sm:block")}><Table><TableHeader><TableRow><TableHead>Audit</TableHead><TableHead>Warehouse</TableHead><TableHead>Counter</TableHead><TableHead>Reviewer</TableHead><TableHead>Status</TableHead><TableHead>Counted SKUs</TableHead><TableHead>Unknown UPCs</TableHead><TableHead>Started</TableHead><TableHead>Completed</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader><TableBody>{sortedAudits.map((audit) => { const lineCount = Number(audit.lineCount ?? (Array.isArray(audit.lines) ? audit.lines.length : 0)); const unknownCount = Number(audit.unknownBarcodeCount ?? (Array.isArray(audit.unknownBarcodes) ? audit.unknownBarcodes.length : 0)); const href = `${mobile ? "/warehouse/mobile/audits" : "/warehouse/audits"}/${encodeURIComponent(String(audit.id))}`; return <TableRow key={String(audit.id)}><TableCell><a className="font-medium text-primary hover:underline" href={href}>{String(audit.auditNumber || "Audit")}</a></TableCell><TableCell>{String(audit.warehouseName || "-")}</TableCell><TableCell>{String(audit.createdBy || "-")}</TableCell><TableCell>{String(audit.reviewer || "Unassigned")}</TableCell><TableCell>{auditStatus(audit)}</TableCell><TableCell>{numberLabel(lineCount)}</TableCell><TableCell>{numberLabel(unknownCount)}</TableCell><TableCell>{dateLabel(String(audit.createdAt || ""))}</TableCell><TableCell>{audit.completedAt ? dateLabel(String(audit.completedAt)) : "-"}</TableCell><TableCell className="text-right">{auditActions(audit)}</TableCell></TableRow> })}{!audits.length && <TableRow><TableCell colSpan={10} className="h-20 text-center text-muted-foreground">No warehouse audits have been created yet.</TableCell></TableRow>}</TableBody></Table></div>{totalPages > 1 && <div className="flex items-center justify-between gap-3 border-t px-4 py-3"><p className="text-xs text-muted-foreground">Page {numberLabel(page)} of {numberLabel(totalPages)}</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button><Button size="sm" variant="outline" disabled={loading || page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>Next</Button></div></div>}</CardContent></Card><Dialog open={Boolean(actionAudit)} onOpenChange={(open) => !open && setActionAudit(null)}><DialogContent><DialogHeader><DialogTitle>{action === "lock" ? "Lock warehouse audit" : "Delete warehouse audit"}</DialogTitle><DialogDescription>{action === "lock" ? "Locking stops all scanning and count changes. This audit remains available for review and export." : "Deleting removes this audit and its stored count work. Completed audits cannot be deleted because their counts have already been applied."}</DialogDescription></DialogHeader><Field label="Administrator PIN"><Input autoFocus type="password" inputMode="numeric" value={pin} onChange={(event) => setPin(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void confirmAction() } }} placeholder="Enter administrator PIN" /></Field><DialogFooter><Button variant="outline" onClick={() => setActionAudit(null)}>Cancel</Button><Button variant={action === "delete" ? "destructive" : "default"} disabled={acting || !pin.trim()} onClick={() => void confirmAction()}>{acting ? <Loader2 className="size-4 animate-spin" /> : action === "lock" ? <LockKeyhole className="size-4" /> : <Trash2 className="size-4" />}{action === "lock" ? "Lock audit" : "Delete audit"}</Button></DialogFooter></DialogContent></Dialog></>
}

function PickScanPanel({ onChanged }: { onChanged: () => Promise<void> }) {
  const [pickLists, setPickLists] = useState<Array<Record<string, unknown>>>([])
  const [pickListId, setPickListId] = useState("")
  const [barcode, setBarcode] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<{ pickLists?: Array<Record<string, unknown>> }>("/api/fulfillment/pick-lists").then((result) => { const rows = (result.pickLists || []).filter((row) => String(row.status) === "picking"); setPickLists(rows); setPickListId((current) => current || String(rows[0]?.id || "")) }).catch(() => undefined) }, [])
  const scan = async () => { if (!pickListId || !barcode.trim()) return; setBusy(true); try { const result = await api<{ message?: string }>(`/api/fulfillment/pick-lists/${encodeURIComponent(pickListId)}/scan`, { method: "POST", body: JSON.stringify({ barcode, user: "Warehouse" }) }); setBarcode(""); toast.success(result.message || "Line picked."); await onChanged() } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to scan pick line.") } finally { setBusy(false) } }
  if (!pickLists.length) return null
  return <Card><CardHeader><CardTitle className="text-base">Pick by barcode</CardTitle><CardDescription>Use a Bluetooth scanner or enter a UPC. DataPlus confirms that the item belongs to the selected Pick List before marking it picked.</CardDescription></CardHeader><CardContent className="flex flex-wrap items-end gap-2"><Field label="Pick List"><Select value={pickListId} onValueChange={setPickListId}><SelectTrigger className="w-48"><SelectValue /></SelectTrigger><SelectContent>{pickLists.map((row) => <SelectItem key={String(row.id)} value={String(row.id)}>{String(row.pickListNumber)}</SelectItem>)}</SelectContent></Select></Field><Field label="Barcode"><Input autoFocus value={barcode} onChange={(event) => setBarcode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void scan() } }} placeholder="Scan UPC" /></Field><Button disabled={busy || !pickListId || !barcode.trim()} onClick={() => void scan()}>{busy && <Loader2 className="size-4 animate-spin" />} Confirm pick</Button></CardContent></Card>
}

function ManualReceivingPanel({ mobile = false }: { mobile?: boolean } = {}) {
  const lookupRef = useRef<HTMLInputElement>(null)
  const [lookup, setLookup] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [warehouse, setWarehouse] = useState("Staten Island")
  const [locationBin, setLocationBin] = useState("")
  const [note, setNote] = useState("")
  const [receipts, setReceipts] = useState<Array<Record<string, unknown>>>([])
  const [warehouses, setWarehouses] = useState<Array<{ id?: string; name?: string; requireBinValidation?: boolean; bins?: Array<{ code?: string; name?: string; active?: boolean }> }>>([])
  const [busy, setBusy] = useState(false)
  const load = async () => { try { const [receiptResult, state] = await Promise.all([api<{ receipts?: Array<Record<string, unknown>> }>("/api/warehouse-receipts"), api<LiteState>("/api/state?lite=1")]); setReceipts(receiptResult.receipts || []); const physical = (state.warehouses || []).filter(item => item.isPhysical !== false && item.inventorySourceType !== "supplier_feed" && item.allowReceiving !== false); setWarehouses(physical as typeof warehouses); if (mobile) setWarehouse(current => physical.some(item => String(item.id) === current || String(item.name) === current) ? current : String(physical[0]?.id || "")) } catch { /* The receipt form remains usable if history is unavailable. */ } }
  useEffect(() => { void load() }, [])
  const receive = async () => {
    if ((mobile && !selectedWarehouse) || busy || !lookup.trim() || !Number.isFinite(Number(quantity)) || Number(quantity) <= 0 || (selectedWarehouse?.requireBinValidation === true && !locationBin)) return
    setBusy(true)
    try {
      const result = await api<{ receipt?: Record<string, unknown>; message?: string }>("/api/warehouse-receipts", { method: "POST", body: JSON.stringify({ lookup, quantity: Number(quantity), warehouseName: warehouse, locationBin, note, user: "Warehouse" }) })
      toast.success(result.message || "Manual receipt posted.")
      setLookup("")
      setQuantity("1")
      setLocationBin("")
      setNote("")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to post manual receipt.")
    } finally { setBusy(false); if (mobile) window.setTimeout(() => lookupRef.current?.focus(), 0) }
  }
  const selectedWarehouse = warehouses.find((item) => String(item.id) === warehouse || String(item.name || "").toLowerCase() === warehouse.toLowerCase())
  const activeBins = (selectedWarehouse?.bins || []).filter((bin) => bin.active !== false)
  const binRequired = selectedWarehouse?.requireBinValidation === true
  return <Card><CardHeader><CardTitle className="text-base">Manual receiving</CardTitle><CardDescription>Receive catalog inventory that arrives without a purchase order. Every receipt posts a warehouse-level count and an auditable inventory ledger entry.</CardDescription></CardHeader><CardContent className="grid gap-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_120px_180px_180px]"><Field label="SKU, UPC, or barcode"><Input ref={lookupRef} autoFocus autoComplete="off" value={lookup} onChange={(event) => setLookup(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (mobile) document.getElementById("manual-receipt-quantity")?.focus(); else void receive() } }} placeholder="Scan or enter identifier" /></Field><Field label="Quantity"><Input id="manual-receipt-quantity" inputMode="numeric" type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field><Field label="Receiving warehouse">{warehouses.length ? <Select value={String(selectedWarehouse?.id || warehouse)} onValueChange={(value) => { const next = warehouses.find((item) => String(item.id) === value); setWarehouse(String(next?.id || value)); setLocationBin("") }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{warehouses.map((item) => <SelectItem key={String(item.id)} value={String(item.id)}>{String(item.name || "Warehouse")}</SelectItem>)}</SelectContent></Select> : <Input value={warehouse} onChange={(event) => setWarehouse(event.target.value)} placeholder="Staten Island" />}</Field><Field label={binRequired ? "Bin location (required)" : "Bin location"}>{activeBins.length ? <Select value={locationBin || "__none"} onValueChange={(value) => setLocationBin(value === "__none" ? "" : value)}><SelectTrigger><SelectValue placeholder="Select bin" /></SelectTrigger><SelectContent>{!binRequired && <SelectItem value="__none">No bin</SelectItem>}{activeBins.map((bin) => <SelectItem key={String(bin.code)} value={String(bin.code)}>{String(bin.code)}{bin.name ? ` - ${String(bin.name)}` : ""}</SelectItem>)}</SelectContent></Select> : <Input value={locationBin} onChange={(event) => setLocationBin(event.target.value)} placeholder={binRequired ? "Configure a bin first" : "Optional bin"} />}</Field></div><div className="flex flex-wrap items-end gap-3"><Field label="Receiving note"><Input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Delivery, adjustment, or receiving note" /></Field><Button disabled={(mobile && !selectedWarehouse) || busy || !lookup.trim() || Number(quantity) <= 0 || (binRequired && !locationBin)} onClick={() => void receive()}>{busy && <Loader2 className="size-4 animate-spin" />} Post receipt</Button></div>{receipts.length > 0 && <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Receipt</TableHead><TableHead>SKU</TableHead><TableHead>Quantity</TableHead><TableHead>Warehouse / bin</TableHead><TableHead>Received</TableHead></TableRow></TableHeader><TableBody>{receipts.slice(0, 5).map((receipt) => { const item = (Array.isArray(receipt.items) ? receipt.items[0] : {}) as Record<string, unknown>; const sku = String(item.sku || ""); return <TableRow key={String(receipt.id)}><TableCell className="font-medium">{String(receipt.receiptNumber || "Receipt")}</TableCell><TableCell>{sku ? <a className="font-medium hover:underline" href={`/products/${encodeURIComponent(sku)}`} target="_blank" rel="noreferrer" title={`Open ${sku} in a new tab`}>{sku}</a> : "-"}</TableCell><TableCell>{numberLabel(Number(item.qtyReceived || 0))}</TableCell><TableCell>{String(receipt.warehouseName || "-")}{receipt.locationBin ? ` / ${String(receipt.locationBin)}` : ""}</TableCell><TableCell>{dateLabel(String(receipt.receivedAt || ""))}</TableCell></TableRow> })}</TableBody></Table></div>}</CardContent></Card>
}

type AuditSupplierOption = {
  key: string
  vendorId?: string
  supplierName: string
  supplierCode?: string
  sourceSku?: string
  vendorSku?: string
  manufacturerSku?: string
  barcode?: string
  cost?: number
  qty?: number
  matchType?: string
  matchStatus?: string
  requiresReview?: boolean
  reviewId?: string
  confidence?: number | null
}

type AuditSupplierCacheEntry = {
  options: AuditSupplierOption[]
  expiresAt: number
  indexReady?: boolean
  indexBuilding?: boolean
  message?: string
}

const auditSupplierOptionsCache = new Map<string, AuditSupplierCacheEntry>()

function AuditSupplierCell({ auditId, auditStatus, line, onLineUpdate }: { auditId: string; auditStatus: string; line: Record<string, unknown>; onLineUpdate: (lineKey: string, line: Record<string, unknown>) => void }) {
  const supplierCount = Number(line.supplierCount || 0)
  const possibleSupplierCount = Number(line.possibleSupplierCount || 0)
  const lineKey = String(line.id || `${String(line.productId || line.sku || "")}::${String(line.locationBin || "")}`)
  const [options, setOptions] = useState<AuditSupplierOption[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState("")
  const [supplierMenuOpen, setSupplierMenuOpen] = useState(false)
  const selectedKey = String(line.selectedSupplierKey || "")
  const selectedName = String(line.selectedSupplierName || line.supplierName || "")
  const supplierCacheKey = `v2:${String(line.productId || line.sku || lineKey).trim().toLowerCase()}`

  useEffect(() => {
    if (!selectedKey || !selectedName) return
    setOptions((current) => current.some((option) => option.key === selectedKey) ? current : [{
      key: selectedKey,
      vendorId: String(line.selectedSupplierId || ""),
      supplierName: selectedName,
      supplierCode: String(line.selectedSupplierCode || ""),
      sourceSku: String(line.selectedSupplierSku || ""),
      vendorSku: String(line.selectedVendorSku || line.selectedSupplierSku || ""),
      manufacturerSku: String(line.selectedManufacturerSku || ""),
      barcode: String(line.selectedSupplierUpc || line.barcode || line.upc || ""),
      cost: Number(line.selectedSupplierCost || 0),
      qty: Number(line.selectedSupplierQty || 0),
      matchType: String(line.selectedSupplierMatchType || "saved"),
    }, ...current])
  }, [line.barcode, line.selectedManufacturerSku, line.selectedSupplierCode, line.selectedSupplierCost, line.selectedSupplierId, line.selectedSupplierMatchType, line.selectedSupplierQty, line.selectedSupplierSku, line.selectedSupplierUpc, line.selectedVendorSku, line.upc, selectedKey, selectedName])

  const loadOptions = async (force = false) => {
    if ((!force && loaded) || loading) return
    const cached = auditSupplierOptionsCache.get(supplierCacheKey)
    if (!force && cached && cached.expiresAt > Date.now()) {
      setOptions(cached.options)
      setLoaded(true)
      setLoadError(cached.message || "")
      return
    }
    setLoading(true)
    setLoadError("")
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 6000)
    try {
      const result = await api<{ options?: AuditSupplierOption[]; indexReady?: boolean; indexBuilding?: boolean; message?: string }>(`/api/warehouse-audits/${encodeURIComponent(auditId)}/lines/${encodeURIComponent(lineKey)}/suppliers`, { signal: controller.signal })
      const nextOptions = Array.isArray(result.options) ? result.options : []
      setOptions(nextOptions)
      const rebuildingMessage = result.indexBuilding && !nextOptions.length ? result.message || "Supplier index is still rebuilding. Saved selections remain available." : ""
      auditSupplierOptionsCache.set(supplierCacheKey, {
        options: nextOptions,
        indexReady: result.indexReady,
        indexBuilding: result.indexBuilding,
        message: rebuildingMessage,
        expiresAt: Date.now() + (result.indexBuilding ? 30 * 1000 : 15 * 60 * 1000),
      })
      setLoadError(rebuildingMessage)
      setLoaded(true)
    } catch (error) {
      const message = error instanceof DOMException && error.name === "AbortError" ? "Supplier lookup timed out. Please retry." : error instanceof Error ? error.message : "Supplier options could not be loaded."
      setLoadError(message)
      if (!(error instanceof DOMException && error.name === "AbortError")) toast.error(message)
    } finally {
      window.clearTimeout(timeout)
      setLoading(false)
    }
  }

  const assignSupplier = async (supplierKey: string) => {
    setSaving(true)
    try {
      const result = await api<{ line?: Record<string, unknown>; selection?: AuditSupplierOption; message?: string }>(`/api/warehouse-audits/${encodeURIComponent(auditId)}/lines/${encodeURIComponent(lineKey)}/supplier`, {
        method: "POST",
        body: JSON.stringify({ supplierKey, user: "Luis" }),
      })
      const selected = result.selection
      const nextLine = result.line || (selected ? {
        ...line,
        selectedSupplierKey: selected.key,
        selectedSupplierId: selected.vendorId || "",
        selectedSupplierName: selected.supplierName,
        selectedSupplierCode: selected.supplierCode || "",
        selectedSupplierSku: selected.sourceSku || selected.vendorSku || "",
        selectedVendorSku: selected.vendorSku || "",
        selectedManufacturerSku: selected.manufacturerSku || "",
        selectedSupplierUpc: selected.barcode || String(line.barcode || line.upc || ""),
        selectedSupplierCost: Number(selected.cost || 0),
        selectedSupplierQty: Number(selected.qty || 0),
        selectedSupplierMatchType: selected.matchType || "selected",
        selectedSupplierIndexed: true,
      } : null)
      if (nextLine) onLineUpdate(lineKey, nextLine)
      if (selected) {
        const cached = auditSupplierOptionsCache.get(supplierCacheKey)
        if (cached && !cached.options.some((option) => option.key === selected.key)) {
          auditSupplierOptionsCache.set(supplierCacheKey, { ...cached, options: [selected, ...cached.options] })
        }
      }
      setSupplierMenuOpen(false)
      toast.success(result.message || "Supplier assigned.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Supplier could not be assigned.")
    } finally {
      setSaving(false)
    }
  }

  if (selectedKey && selectedName) {
    const editable = ["in_progress", "pending_review"].includes(auditStatus)
    return <Popover open={supplierMenuOpen} onOpenChange={(open) => { setSupplierMenuOpen(open); if (open) void loadOptions() }}><PopoverTrigger asChild><Button size="sm" variant="outline" disabled={saving || !editable} className="min-w-44 justify-between border-emerald-500/40 bg-emerald-500/10 text-emerald-800 hover:bg-emerald-500/15 dark:text-emerald-200"><span className="flex min-w-0 items-center gap-1.5"><CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" /><span className="truncate">{saving ? "Saving supplier..." : selectedName}</span></span>{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Users className="size-3.5" />}</Button></PopoverTrigger><PopoverContent align="start" className="w-80 p-0"><Command><CommandInput placeholder="Search suppliers, SKU, or MPN..." disabled={loading || Boolean(loadError)} /><CommandList>{loading && <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading supplier offers...</div>}{loadError && <div className="space-y-3 p-3"><p className="text-sm text-destructive">{loadError}</p><Button size="sm" variant="outline" onClick={() => { setLoaded(false); void loadOptions(true) }}><RefreshCw className="size-3.5" /> Retry</Button></div>}{loaded && !loading && !loadError && <><CommandEmpty>No supplier records found.</CommandEmpty><CommandGroup heading="Available suppliers">{options.map((option) => <CommandItem key={option.key} value={`${option.supplierName} ${option.supplierCode || ""} ${option.vendorSku || ""} ${option.manufacturerSku || ""}`} onSelect={() => void assignSupplier(option.key)}><CheckCircle2 className={cn("size-4", option.key === selectedKey ? "text-emerald-600" : "text-transparent")} /><span className="min-w-0 flex-1"><span className="flex items-center gap-2 truncate font-medium">{option.supplierName}{option.requiresReview && <Badge variant="outline" className="border-amber-400 bg-amber-50 text-[10px] text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">MPN match · review</Badge>}</span><span className="block truncate text-xs text-muted-foreground">SKU {option.vendorSku || "-"} · MPN {option.manufacturerSku || "-"}{Number(option.cost || 0) > 0 ? ` · ${moneyLabel(Number(option.cost))}` : ""}</span></span></CommandItem>)}</CommandGroup></>}</CommandList></Command></PopoverContent></Popover>
  }

  if (supplierCount >= 2 || possibleSupplierCount >= 2) {
    const editable = ["in_progress", "pending_review"].includes(auditStatus)
    return <Popover open={supplierMenuOpen} onOpenChange={(open) => { setSupplierMenuOpen(open); if (open) void loadOptions() }}><PopoverTrigger asChild><Button size="sm" variant="secondary" disabled={saving || !editable} className="min-w-44 justify-between border border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-100 dark:bg-amber-950/50 dark:text-amber-100"><span className="truncate">{saving ? "Saving supplier..." : "Choose supplier"}</span>{saving ? <Loader2 className="size-3.5 animate-spin" /> : <Users className="size-3.5" />}</Button></PopoverTrigger><PopoverContent align="start" className="w-80 p-0"><Command><CommandInput placeholder="Search suppliers, SKU, or MPN..." disabled={loading || Boolean(loadError)} /><CommandList>{loading && <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading supplier offers...</div>}{loadError && <div className="space-y-3 p-3"><p className="text-sm text-destructive">{loadError}</p><Button size="sm" variant="outline" onClick={() => { setLoaded(false); void loadOptions(true) }}><RefreshCw className="size-3.5" /> Retry</Button></div>}{loaded && !loading && !loadError && <><CommandEmpty>No supplier records found.</CommandEmpty><CommandGroup heading="Available suppliers">{options.map((option) => <CommandItem key={option.key} value={`${option.supplierName} ${option.supplierCode || ""} ${option.vendorSku || ""} ${option.manufacturerSku || ""}`} onSelect={() => void assignSupplier(option.key)}><CheckCircle2 className="size-4 text-transparent" /><span className="min-w-0 flex-1"><span className="flex items-center gap-2 truncate font-medium">{option.supplierName}{option.requiresReview && <Badge variant="outline" className="border-amber-400 bg-amber-50 text-[10px] text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">MPN match · review</Badge>}</span><span className="block truncate text-xs text-muted-foreground">SKU {option.vendorSku || "-"} · MPN {option.manufacturerSku || "-"}{Number(option.cost || 0) > 0 ? ` · ${moneyLabel(Number(option.cost))}` : ""}</span></span></CommandItem>)}</CommandGroup></>}</CommandList></Command></PopoverContent></Popover>
  }
  if (supplierCount === 1) {
    const editable = ["in_progress", "pending_review"].includes(auditStatus)
    return <Popover open={supplierMenuOpen} onOpenChange={(open) => { setSupplierMenuOpen(open); if (open) void loadOptions() }}><PopoverTrigger asChild><Button size="sm" variant="ghost" disabled={saving || !editable} className="min-w-36 justify-between"><span className="truncate">{selectedName || String(line.supplierName || "Single supplier")}</span>{loading ? <Loader2 className="size-3.5 animate-spin" /> : <Users className="size-3.5 text-muted-foreground" />}</Button></PopoverTrigger><PopoverContent align="start" className="w-80 p-0"><Command><CommandInput placeholder="Search suppliers, SKU, or MPN..." disabled={loading || Boolean(loadError)} /><CommandList>{loading && <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Checking supplier matches...</div>}{loadError && <div className="space-y-3 p-3"><p className="text-sm text-destructive">{loadError}</p><Button size="sm" variant="outline" onClick={() => { setLoaded(false); void loadOptions(true) }}><RefreshCw className="size-3.5" /> Retry</Button></div>}{loaded && !loading && !loadError && <><CommandEmpty>No supplier records found.</CommandEmpty><CommandGroup heading="Supplier matches">{options.map((option) => <CommandItem key={option.key} value={`${option.supplierName} ${option.supplierCode || ""} ${option.vendorSku || ""} ${option.manufacturerSku || ""}`} onSelect={() => void assignSupplier(option.key)}><CheckCircle2 className="size-4 text-transparent" /><span className="min-w-0 flex-1"><span className="flex items-center gap-2 truncate font-medium">{option.supplierName}{option.requiresReview && <Badge variant="outline" className="border-amber-400 bg-amber-50 text-[10px] text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">MPN match · review</Badge>}</span><span className="block truncate text-xs text-muted-foreground">SKU {option.vendorSku || "-"} · MPN {option.manufacturerSku || "-"}{Number(option.cost || 0) > 0 ? ` · ${moneyLabel(Number(option.cost))}` : ""}</span></span></CommandItem>)}</CommandGroup></>}</CommandList></Command></PopoverContent></Popover>
  }
  return <span className="text-xs text-muted-foreground">No supplier match</span>
}

const warehouseAuditReasonOptions = [
  { value: "cycle_count", label: "Cycle count" },
  { value: "new_inventory_onboarding", label: "New inventory onboarding" },
  { value: "extra_stock", label: "Extra stock" },
  { value: "ebay_one_time_listing", label: "One-time eBay listings" },
  { value: "receiving_inventory", label: "Receive inventory" },
  { value: "external_po_receipt", label: "External PO receipt" },
] as const;

const warehouseUomOptions = [
  { value: "EA", label: "Each" },
  { value: "CS", label: "Case" },
  { value: "PK", label: "Pack" },
  { value: "BX", label: "Box" },
  { value: "CT", label: "Carton" },
  { value: "BD", label: "Bundle" },
  { value: "BG", label: "Bag" },
  { value: "ST", label: "Set" },
  { value: "PR", label: "Pair" },
  { value: "RL", label: "Roll" },
  { value: "RM", label: "Ream" },
  { value: "KT", label: "Kit" },
  { value: "PL", label: "Pallet" },
] as const;

function isReceivingAuditReason(value: unknown) {
  return ["receiving_inventory", "external_po_receipt", "purchase_order_receipt"].includes(String(value || ""));
}

function warehouseAuditReasonLabel(value: unknown, savedLabel?: unknown) {
  const explicit = String(savedLabel || "").trim();
  if (explicit) return explicit;
  if (String(value || "") === "purchase_order_receipt") return "DataPlus PO receipt";
  return warehouseAuditReasonOptions.find((option) => option.value === String(value || ""))?.label || "";
}

function blobDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(new Error("Unable to prepare the product photo."))
    reader.readAsDataURL(blob)
  })
}

function WarehouseAuditPanel({
  auditId = "",
  createOnly = false,
  mobile = false,
  operatorName = "Luis",
}: {
  auditId?: string;
  createOnly?: boolean;
  mobile?: boolean;
  operatorName?: string;
}) {
  const [binLabelsOpen, setBinLabelsOpen] = useState(false);
  const [itemImage, setItemImage] = useState<{ src: string; title: string } | null>(null);
  const [noteItem, setNoteItem] = useState<Record<string, unknown> | null>(null);
  const [itemNote, setItemNote] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [itemSort, setItemSort] = useState<WarehouseAuditSort>("newest");
  const [auditToolsOpen, setAuditToolsOpen] = useState(false);
  const [shareAuditUrl, setShareAuditUrl] = useState("");
  const [desktopAuditTools, setDesktopAuditTools] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    const update = () => { setDesktopAuditTools(media.matches); if (!media.matches) setAuditToolsOpen(false); };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const [audits, setAudits] = useState<Array<Record<string, unknown>>>([]);
  const [active, setActive] = useState<Record<string, unknown> | null>(null);
  const [barcode, setBarcode] = useState("");
  const [warehouse, setWarehouse] = useState("Staten Island");
  const [auditReason, setAuditReason] = useState("cycle_count");
  const [receivingSupplier, setReceivingSupplier] = useState("True Value");
  const [receivingSupplierId, setReceivingSupplierId] = useState("");
  const [externalPurchaseOrderNumber, setExternalPurchaseOrderNumber] = useState("");
  const [createVendorOpen, setCreateVendorOpen] = useState(false);
  const [auditVendors, setAuditVendors] = useState<Vendor[]>([]);
  const [receivingDocumentType, setReceivingDocumentType] = useState<"packing_slip" | "purchase_order">("packing_slip");
  const [receivingDocumentBusy, setReceivingDocumentBusy] = useState(false);
  const [receivingDocumentPreview, setReceivingDocumentPreview] = useState<Record<string, unknown> | null>(null);
  const [auditsLoading, setAuditsLoading] = useState(true);
  const [purposeEditorOpen, setPurposeEditorOpen] = useState(false);
  const [purposeDraft, setPurposeDraft] = useState("");
  const [purposeSaving, setPurposeSaving] = useState(false);
  const [auditOwner, setAuditOwner] = useState(operatorName);
  const [activeBin, setActiveBin] = useState("");
  const [clearBinTarget, setClearBinTarget] = useState("");
  const [clearBinReason, setClearBinReason] = useState("");
  const [clearBinPin, setClearBinPin] = useState("");
  const [clearBinBusy, setClearBinBusy] = useState(false);
  const requestClearBin = () => { setClearBinReason(""); setClearBinPin(""); setClearBinTarget(activeBin); };

  const [auditWarehouses, setAuditWarehouses] = useState<Array<{ id?: string; name?: string; code?: string; warehouseType?: string; inventorySourceType?: string; isPhysical?: boolean; bins?: Array<{ id?: string; code?: string; name?: string; nickname?: string; active?: boolean; isDefault?: boolean }> }>>([]);
  const [dispositionOpen, setDispositionOpen] = useState(false);
  const [dispositionType, setDispositionType] = useState<"fulfill_orders" | "stock_here" | "transfer" | "return_to_supplier">("stock_here");
  const [destinationWarehouseId, setDestinationWarehouseId] = useState("");
  const [dispositionNote, setDispositionNote] = useState("");
  const [actionPreview, setActionPreview] = useState<Record<string, unknown> | null>(null);
  const [actionPreviewLoading, setActionPreviewLoading] = useState(false);
  const [actionPreviewError, setActionPreviewError] = useState("");
  const [returnDespiteDemand, setReturnDespiteDemand] = useState(false);
  const [cameraMode, setCameraMode] = useState<"product" | "bin">("product");
  const [offlineScanCount, setOfflineScanCount] = useState(0);
  const [syncingOfflineScans, setSyncingOfflineScans] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const cameraOpenRef = useRef(cameraOpen);
  cameraOpenRef.current = cameraOpen;
  useEffect(() => { if (cameraOpen) toast.dismiss(); }, [cameraOpen]);
  const [cameraStreamState, setCameraStreamState] = useState<"opening" | "ready" | "permission" | "error">("opening");
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [cameraDevices, setCameraDevices] = useState<Array<{ id: string; label: string }>>([]);
  const [selectedCameraId, setSelectedCameraId] = useState("");
  const [cameraMessage, setCameraMessage] = useState(
    "Camera ready. Point it at the next barcode.",
  );
  const [lastScan, setLastScan] = useState<{
    barcode: string;
    matched: boolean;
    message: string;
    sku?: string;
    title?: string;
    uom?: string;
    uomName?: string;
    casePack?: number;
  } | null>(null);
  const [cameraScanQuantity, setCameraScanQuantity] = useState("1");
  const [cameraLookupBusy, setCameraLookupBusy] = useState(false);
  const [quickCreateBusy, setQuickCreateBusy] = useState(false);
  const [quickCreatePhotoOpen, setQuickCreatePhotoOpen] = useState(false);
  const [quickCreateResumeScanner, setQuickCreateResumeScanner] = useState(false);
  const [manualQuickCreateClientId, setManualQuickCreateClientId] = useState("");
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torchEnabled, setTorchEnabled] = useState(false);
  const [scannerEngine, setScannerEngine] = useState<"native" | "zxing">("zxing");
  const scannerControlsRef = useRef<Awaited<ReturnType<typeof startFastBarcodeScanner>> | null>(null);
  const [manualUnknown, setManualUnknown] = useState<Record<
    string,
    string
  > | null>(null);
  const [manualSkuLoading, setManualSkuLoading] = useState(false);
  const [manualPhotoUrls, setManualPhotoUrls] = useState<string[]>([]);
  const [photoAnalysisBusy, setPhotoAnalysisBusy] = useState(false);
  const [photoAnalysisStatus, setPhotoAnalysisStatus] = useState<"idle" | "analyzing" | "ready" | "error">("idle");
  const [upcResearchBusy, setUpcResearchBusy] = useState(false);
  const [upcResearch, setUpcResearch] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [countEditLine, setCountEditLine] = useState<Record<string, unknown> | null>(null);
  const [countEditValue, setCountEditValue] = useState("");
  const [countEditNote, setCountEditNote] = useState("");
  const [countEditBin, setCountEditBin] = useState("");
  const [countEditBusy, setCountEditBusy] = useState(false);
  const [scannerSettings, setScannerSettings] = useState<SystemSettings>({});
  const [quickPreviewItem, setQuickPreviewItem] = useState<CatalogItem | null>(null);
  const [foundStockFileName, setFoundStockFileName] = useState("");
  const [foundStockCsv, setFoundStockCsv] = useState("");
  const [includeAlreadyListedFoundStock, setIncludeAlreadyListedFoundStock] = useState(false);
  const [foundStockImporting, setFoundStockImporting] = useState(false);
  const [ebayReadinessBusy, setEbayReadinessBusy] = useState(false);
  const [ebayShadowLaunchBusy, setEbayShadowLaunchBusy] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const quickCreatePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const manualTitleRef = useRef<HTMLInputElement | null>(null);
  const manualCreateRef = useRef<HTMLDivElement | null>(null);
  const photoAnalysisRequestRef = useRef(0);
  const scanRef = useRef(false);
  const submitScanRef = useRef<(value: string, quantity?: number) => Promise<string | undefined>>(async () => undefined);
  const lastCameraScanRef = useRef({ value: "", at: 0 });
  const offlineQueueKey = "dataplus.warehouse-audit.offline-scans.v1";
  const readOfflineScans = () => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(offlineQueueKey) || "[]");
      return Array.isArray(saved) ? saved as Array<{ auditId: string; barcode: string; locationBin: string; quantity?: number; queuedAt: string }> : [];
    } catch { return []; }
  };
  const writeOfflineScans = (scans: Array<{ auditId: string; barcode: string; locationBin: string; quantity?: number; queuedAt: string }>) => {
    try { window.localStorage.setItem(offlineQueueKey, JSON.stringify(scans.slice(-500))); } catch { /* A full browser store should not block scanning. */ }
  };
  const scannerFeedback = (kind: "pending" | "success" | "unknown" | "error") => {
    const vibrationIntensity = String(scannerSettings.warehouseScannerVibrationIntensity || "medium").toLowerCase();
    const soundIntensity = String(scannerSettings.warehouseScannerSoundIntensity || "medium").toLowerCase();
    const vibrationScale = vibrationIntensity === "low" ? 0.55 : vibrationIntensity === "high" ? 1.55 : 1;
    const soundGain = soundIntensity === "low" ? 0.02 : soundIntensity === "high" ? 0.075 : 0.045;
    const soundDuration = soundIntensity === "low" ? 0.09 : soundIntensity === "high" ? 0.18 : 0.13;
    const vibration = kind === "pending" ? 18 : kind === "success" ? [35] : kind === "unknown" ? [35, 55, 35] : [80, 45, 80];
    if (scannerSettings.warehouseScannerVibrationEnabled !== false) {
      try {
        const scaled = Array.isArray(vibration)
          ? vibration.map((duration) => Math.max(1, Math.round(duration * vibrationScale)))
          : Math.max(1, Math.round(vibration * vibrationScale));
        navigator.vibrate?.(scaled);
      } catch { /* Browsers may block haptics. */ }
    }
    if (scannerSettings.warehouseScannerSoundEnabled !== false) try {
      const Audio = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Audio) return;
      const context = new Audio();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.value = kind === "pending" ? 660 : kind === "success" ? 880 : kind === "unknown" ? 520 : 260;
      gain.gain.setValueAtTime(soundGain, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + soundDuration);
      oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + soundDuration + 0.01);
    } catch { /* Audio feedback is optional. */ }
  };
  const refreshCameraDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices())
        .filter((device) => device.kind === "videoinput")
        .map((device, index) => ({ id: device.deviceId, label: device.label || `Camera ${index + 1}` }));
      setCameraDevices(devices);
      setSelectedCameraId((current) => {
        if (current && devices.some((device) => device.id === current)) return current;
        return devices.find((device) => /back|rear|environment|world/i.test(device.label))?.id || current;
      });
    } catch { /* Camera selection remains optional. */ }
  };
  const load = async () => {
    setAuditsLoading(true);
    try {
      const auditRequest = async () => {
        if (auditId) {
          const result = await api<{ audit?: Record<string, unknown> }>(`/api/warehouse-audits/${encodeURIComponent(auditId)}`);
          return { audits: result.audit ? [result.audit] : [] };
        }
        const summaries = await api<{ audits?: Array<Record<string, unknown>> }>("/api/warehouse-audits?summary=1&status=in_progress&pageSize=1");
        const activeSummary = summaries.audits?.[0];
        if (!activeSummary?.id) return { audits: [] };
        const result = await api<{ audit?: Record<string, unknown> }>(`/api/warehouse-audits/${encodeURIComponent(String(activeSummary.id))}`);
        return { audits: result.audit ? [result.audit] : [] };
      };
      const [result, state] = await Promise.all([
        auditRequest(),
        api<LiteState>("/api/state?lite=1"),
      ]);
      setAudits(result.audits || []);
      setAuditWarehouses((state.warehouses || []) as typeof auditWarehouses);
      setAuditVendors((state.vendors || []).filter((vendor) => String(vendor.status || "active").toLowerCase() === "active"));
      setScannerSettings(state.systemSettings || {});
    } finally {
      setAuditsLoading(false);
    }
  };
  const resumedAudit =
    active ||
    audits.find((audit) =>
      auditId
        ? String(audit.id) === auditId
        : String(audit.status) === "in_progress",
    ) ||
    null;
  const applyAuditUpdate = (audit: Record<string, unknown>) => {
    // Keep the scanner responsive even while the audit-register refresh finishes.
    const snapshot: Record<string, unknown> = {
      ...audit,
      lines: Array.isArray(audit.lines) ? [...audit.lines] : [],
      unknownBarcodes: Array.isArray(audit.unknownBarcodes)
        ? [...audit.unknownBarcodes]
        : [],
    };
    setActive(snapshot);
    setAudits((current) => [
      snapshot,
      ...current.filter((row) => String(row.id) !== String(snapshot.id)),
    ]);
  };
  const applyAuditLineUpdate = (targetLineKey: string, nextLine: Record<string, unknown>) => {
    const patchAudit = (audit: Record<string, unknown>): Record<string, unknown> => ({
      ...audit,
      lines: (Array.isArray(audit.lines) ? audit.lines : []).map((line) => {
        const row = line as Record<string, unknown>;
        const rowKey = String(row.id || `${String(row.productId || row.sku || "")}::${String(row.locationBin || "")}`);
        return rowKey === targetLineKey ? { ...row, ...nextLine } : row;
      }),
    });
    const snapshot = patchAudit((active || resumedAudit || {}) as Record<string, unknown>);
    setActive(snapshot);
    setAudits((current) => current.map((audit) => String(audit.id) === String(snapshot.id) ? patchAudit(audit) : audit));
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!resumedAudit?.id) return;
    setOfflineScanCount(readOfflineScans().filter((scan) => scan.auditId === String(resumedAudit.id)).length);
  }, [resumedAudit?.id]);
  useEffect(() => {
    const auditSupplierId = String(resumedAudit?.supplierId || "");
    const auditSupplierName = String(resumedAudit?.supplierName || receivingSupplier || "").trim().toLowerCase()
    const matched = auditVendors.find((vendor) => vendor.id === auditSupplierId) || auditVendors.find((vendor) => [vendor.name, vendor.code].some((value) => String(value || "").trim().toLowerCase() === auditSupplierName))
    if (matched) {
      setReceivingSupplierId(matched.id)
      setReceivingSupplier(matched.name)
    }
  }, [resumedAudit?.id, resumedAudit?.supplierId, resumedAudit?.supplierName, auditVendors.length])
  const selectReceivingSupplier = (vendorId: string) => {
    const vendor = auditVendors.find((candidate) => candidate.id === vendorId)
    setReceivingSupplierId(vendorId)
    setReceivingSupplier(vendor?.name || "")
  }
  const selectedAuditWarehouse = auditWarehouses.find((warehouse) =>
    String(warehouse.id || "") === String(resumedAudit?.warehouseId || "") ||
    String(warehouse.name || "").trim().toLowerCase() === String(resumedAudit?.warehouseName || "").trim().toLowerCase(),
  );
  const selectedCreateWarehouse = auditWarehouses.find((item) =>
    String(item.id || "") === String(warehouse) ||
    String(item.name || "").trim().toLowerCase() === String(warehouse).trim().toLowerCase(),
  );
  const activeAuditBins = (selectedAuditWarehouse?.bins || []).filter((bin) => bin.active !== false && String(bin.code || "").trim());
  useEffect(() => {
    if (activeBin || !activeAuditBins.length) return;
    const preferred = activeAuditBins.find((bin) => bin.isDefault) || activeAuditBins[0];
    setActiveBin(String(preferred.code || ""));
  }, [resumedAudit?.id, activeAuditBins.length]);
  useEffect(() => {
    if (!createOnly || warehouse !== "Staten Island" || !auditWarehouses.length) return;
    const physicalWarehouse = auditWarehouses.find(
      (item) => String(item.name || "").trim().toLowerCase() === "staten island 2",
    );
    const preferredWarehouse = physicalWarehouse || (mobile ? auditWarehouses.find(item => item.isPhysical !== false && item.inventorySourceType !== "supplier_feed") : undefined);
    if (preferredWarehouse?.id) setWarehouse(String(preferredWarehouse.id));
  }, [createOnly, auditWarehouses, warehouse]);
  useEffect(() => {
    if (!cameraOpen) return;
    let controls: Awaited<ReturnType<typeof startFastBarcodeScanner>> | null = null;
    let canceled = false;
    let retryTimer: number | undefined;
    const start = async (attempt = 0) => {
      if (canceled || !cameraOpen) return;
      const video = videoRef.current;
      // The full-screen Dialog mounts through a portal. On Safari, the effect
      // can run just before this video is attached to the DOM.
      if (!video) {
        if (attempt < 8) retryTimer = window.setTimeout(() => void start(attempt + 1), 40);
        return;
      }
      try {
        if (!resumedAudit) return;
        setCameraStreamState("opening");
        controls = await startFastBarcodeScanner(
          video,
          (decodedValue) => {
            const value = String(decodedValue || "").trim();
            const now = Date.now();
            if (
              canceled ||
              !value ||
              scanRef.current ||
              (lastCameraScanRef.current.value === value &&
                now - lastCameraScanRef.current.at < 1800)
            )
              return;
            scanRef.current = true;
            lastCameraScanRef.current = { value, at: now };
            setBarcode(value);
            setCameraMessage(`Looking up ${value}...`);
            setCameraLookupBusy(true);
            void api<{
              matched?: boolean;
              message?: string;
              product?: { sku?: string; title?: string; uom?: string; uomName?: string; casePack?: number } | null;
            }>(
              `/api/warehouse-audits/${encodeURIComponent(String(resumedAudit.id))}/lookup`,
              { method: "POST", body: JSON.stringify({ barcode: value }) },
            ).then((lookup) => {
              const matched = lookup.matched === true;
              const product = lookup.product || null;
              if (cameraMode === "bin") {
                setCameraMessage(`Selecting bin ${value}...`);
                return submitScanRef.current(value).then(() => {
                  scanRef.current = false;
                  lastCameraScanRef.current = { value: "", at: 0 };
                });
              }
              if (matched) {
                setLastScan({ barcode: value, matched: true, message: lookup.message || "Catalog item found.", sku: product?.sku, title: product?.title, uom: product?.uom, uomName: product?.uomName, casePack: Number(product?.casePack || 1) });
                setCameraScanQuantity("1");
                setCameraMessage(`${product?.sku || value} matched. Enter the quantity you counted, then tap Next.`);
                scannerFeedback("success");
                return;
              }
              setLastScan({
                barcode: value,
                matched,
                message: lookup.message || (matched ? "Catalog item found." : "No catalog item found."),
                sku: product?.sku,
                title: product?.title,
                uom: product?.uom,
                uomName: product?.uomName,
                casePack: product?.casePack,
              });
              setCameraMessage("Product not found. You can add it or cancel this scan.");
              scannerFeedback("unknown");
            }).catch((error) => {
              const message = error instanceof Error ? error.message : "Unable to look up this barcode.";
              setCameraMessage(message);
              scannerFeedback("error");
              scanRef.current = false;
            }).finally(() => setCameraLookupBusy(false));
          },
          { deviceId: selectedCameraId || undefined },
        );
        scannerControlsRef.current = controls;
        setScannerEngine(controls.engine);
        setTorchAvailable(controls.torchAvailable);
        setTorchEnabled(false);
        void refreshCameraDevices();
        setCameraStreamState("ready");
      } catch (error) {
        if (!canceled) {
          const name = error instanceof DOMException ? error.name : "";
          setCameraStreamState(name === "NotAllowedError" || name === "SecurityError" ? "permission" : "error");
        }
      }
    };
    void start();
    return () => {
      canceled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      controls?.stop();
      if (scannerControlsRef.current === controls) scannerControlsRef.current = null;
      setTorchAvailable(false);
      setTorchEnabled(false);
    };
  }, [cameraOpen, cameraAttempt, resumedAudit?.id, selectedCameraId, cameraMode]);
  const create = async () => {
    setBusy(true);
    try {
      const result = await api<{
        audit?: Record<string, unknown>;
        message?: string;
      }>("/api/warehouse-audits", {
        method: "POST",
        body: JSON.stringify({
          warehouseId: selectedCreateWarehouse?.id || "",
          warehouseName: selectedCreateWarehouse?.name || warehouse,
          reason: auditReason,
          supplierId: isReceivingAuditReason(auditReason) ? receivingSupplierId : "",
          supplierName: isReceivingAuditReason(auditReason) ? receivingSupplier : "",
          externalPurchaseOrderNumber: auditReason === "external_po_receipt" ? externalPurchaseOrderNumber.trim() : "",
          user: auditOwner,
        }),
      });
      setActive(result.audit || null);
      toast.success(result.message || "Warehouse audit started.");
      if (createOnly && result.audit?.id) {
        window.location.assign(
          `${mobile ? "/warehouse/mobile/audits" : "/warehouse/audits"}/${encodeURIComponent(String(result.audit.id))}`,
        );
        return;
      }
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to start warehouse audit.",
      );
    } finally {
      setBusy(false);
    }
  };
  const uploadReceivingDocuments = async (files: FileList | File[] | null) => {
    if (!current?.id || !files?.length) return;
    const selected = await Promise.all(Array.from(files).map(async (file) => {
      if (!/^image\/(?:jpe?g|png|webp)$/i.test(file.type)) return file;
      try { return await compressEvidenceImage(file); } catch { return file; }
    }));
    if (selected.some((file) => file.size > 15 * 1024 * 1024)) return toast.error("Each receiving document must be 15 MB or smaller.");
    setReceivingDocumentBusy(true);
    try {
      let updatedAudit: Record<string, unknown> | null = null;
      for (const file of selected) {
        const contentBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(new Error(`Unable to read ${file.name}.`)); reader.readAsDataURL(file) });
        const result = await api<{ audit?: Record<string, unknown> }>(`/api/warehouse-audits/${encodeURIComponent(String(current.id))}/attachments`, { method: "POST", body: JSON.stringify({ name: file.name, mimeType: file.type, contentBase64, documentType: receivingDocumentType, user: operatorName }) });
        updatedAudit = result.audit || updatedAudit;
      }
      if (updatedAudit) {
        applyAuditUpdate(updatedAudit);
        const uploadedDocuments = Array.isArray(updatedAudit.receivingDocuments) ? updatedAudit.receivingDocuments as Array<Record<string, unknown>> : [];
        setReceivingDocumentPreview(uploadedDocuments.at(-1) || null);
      }
      toast.success(`${selected.length} receiving document${selected.length === 1 ? "" : "s"} uploaded.`);
      if (selected.some((file) => /^image\/(?:jpe?g|png|webp)$/i.test(file.type)) && current.supplierName) {
        try {
          const analyzed = await api<{ audit?: Record<string, unknown>; message?: string; fallbackRecommended?: boolean }>(`/api/warehouse-audits/${encodeURIComponent(String(current.id))}/analyze-receiving-documents`, { method: "POST", body: JSON.stringify({ user: operatorName, mode: "ocr" }) });
          if (analyzed.audit) applyAuditUpdate(analyzed.audit);
          if (analyzed.fallbackRecommended) toast.warning(analyzed.message || "Packing slip extracted. Review the low-confidence rows.");
          else toast.success(analyzed.message || "Packing slip compared with the scanned shipment.");
        } catch (error) {
          toast.warning(error instanceof Error ? `Document saved. Automatic extraction needs review: ${error.message}` : "Document saved. Run packing-slip extraction when ready.");
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to upload receiving documents.");
    } finally { setReceivingDocumentBusy(false); }
  };
  const analyzeReceivingDocuments = async (mode: "ocr" | "ai" = "ocr") => {
    if (!current?.id) return;
    setReceivingDocumentBusy(true);
    try {
      const result = await api<{ audit?: Record<string, unknown>; message?: string; fallbackRecommended?: boolean }>(`/api/warehouse-audits/${encodeURIComponent(String(current.id))}/analyze-receiving-documents`, { method: "POST", body: JSON.stringify({ user: operatorName, mode }) });
      if (result.audit) applyAuditUpdate(result.audit);
      if (result.fallbackRecommended) toast.warning(`${result.message || "Local OCR completed."} Review the mapping or use David fallback.`)
      else toast.success(result.message || (mode === "ocr" ? "Receiving documents extracted with local OCR." : "Receiving documents analyzed by David."));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to analyze receiving documents.");
    } finally { setReceivingDocumentBusy(false); }
  };
  const chooseFoundStockFile = async (file?: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      setFoundStockFileName(file.name);
      setFoundStockCsv(text);
      toast.success(`${file.name} ready to import.`);
    } catch {
      toast.error("Unable to read that CSV file.");
    }
  };
  const importFoundStockCsv = async () => {
    if (!resumedAudit || !foundStockCsv.trim()) return toast.error("Choose a found-stock CSV first.");
    setFoundStockImporting(true);
    try {
      const result = await api<{ audit?: Record<string, unknown>; summary?: Record<string, unknown>; message?: string }>(
        `/api/warehouse-audits/${encodeURIComponent(String(resumedAudit.id))}/found-stock-import`,
        { method: "POST", body: JSON.stringify({ csv: foundStockCsv, fileName: foundStockFileName, includeAlreadyListed: includeAlreadyListedFoundStock, user: auditOwner || "Luis" }) },
      );
      applyAuditUpdate(result.audit || resumedAudit);
      setFoundStockCsv("");
      setFoundStockFileName("");
      const summary = result.summary || {};
      const importedCount = Number(summary.imported || 0);
      toast.success(result.message || `Imported ${numberLabel(importedCount)} found-stock row${importedCount === 1 ? "" : "s"}.`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to import found-stock CSV.");
    } finally {
      setFoundStockImporting(false);
    }
  };
  const queueFoundStockEbayReadiness = async () => {
    if (!resumedAudit) return;
    setEbayReadinessBusy(true);
    try {
      const result = await api<{ job?: ImportJob; duplicate?: boolean; message?: string }>(
        `/api/warehouse-audits/${encodeURIComponent(String(resumedAudit.id))}/ebay-readiness`,
        { method: "POST", body: JSON.stringify({ includeAlreadyListed: includeAlreadyListedFoundStock }) },
      );
      toast.success(result.message || "eBay found-stock readiness queued.");
      if (result.job?.id) window.setTimeout(() => { window.history.pushState({}, "", `/jobs/${encodeURIComponent(String(result.job?.id))}`); window.dispatchEvent(new PopStateEvent("popstate")) }, 500);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue eBay readiness.");
    } finally {
      setEbayReadinessBusy(false);
    }
  };
  const launchAuditShadowsOnEbay = async () => {
    if (!resumedAudit) return;
    setEbayShadowLaunchBusy(true);
    try {
      const result = await api<{ audit?: Record<string, unknown>; job?: ImportJob; duplicate?: boolean; message?: string }>(
        `/api/warehouse-audits/${encodeURIComponent(String(resumedAudit.id))}/ebay-shadow-launch`,
        { method: "POST", body: JSON.stringify({ user: operatorName }) },
      );
      if (result.audit) applyAuditUpdate(result.audit);
      toast.success(result.message || "Warehouse shadow launch queued for eBay.");
      if (result.job?.id) window.setTimeout(() => {
        window.history.pushState({}, "", `/jobs/${encodeURIComponent(String(result.job?.id))}`);
        window.dispatchEvent(new PopStateEvent("popstate"));
      }, 500);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue the warehouse shadows for eBay.");
    } finally {
      setEbayShadowLaunchBusy(false);
    }
  };
  const submit = async (value = barcode, quantity = 1) => {
    if (!resumedAudit || !String(value).trim()) return;
    if (cameraMode === "bin") {
      const bin = String(value).trim();
      setActiveBin(bin);
      setCameraMode("product");
      setBarcode("");
      setCameraMessage(`Bin ${bin} selected. Scan the next product.`);
      scannerFeedback("success");
      if (!cameraOpen) toast.success(`Counting in bin ${bin}.`);
      return `Bin ${bin} selected. Scan the next product.`;
    }
    if (!navigator.onLine) {
      const queued = [...readOfflineScans(), { auditId: String(resumedAudit.id), barcode: String(value).trim(), locationBin: activeBin, quantity, queuedAt: new Date().toISOString() }];
      writeOfflineScans(queued);
      setOfflineScanCount(queued.filter((scan) => scan.auditId === String(resumedAudit.id)).length);
      setLastScan({ barcode: String(value), matched: true, message: "Saved offline. It will sync when this phone reconnects." });
      setCameraMessage(`Saved ${value} offline. Ready for the next barcode.`);
      setBarcode("");
      scannerFeedback("success");
      if (!cameraOpen) toast.success("Scan saved on this phone and queued for sync.");
      return `Saved ${value} offline. It will sync when this phone reconnects.`;
    }
    // Trigger a light acknowledgement while this keyboard-wedge or typed UPC is
    // still a user gesture. Some Android browsers block later haptic calls.
    scannerFeedback("pending");
    setBusy(true);
    try {
      const result = await api<{
        audit?: Record<string, unknown>;
        matched?: boolean;
        message?: string;
        product?: { sku?: string; title?: string; marketplaceTitle?: string; uom?: string; uomName?: string; casePack?: number; uomQty?: number } | null;
      }>(
        `/api/warehouse-audits/${encodeURIComponent(String(resumedAudit.id))}/scan`,
        { method: "POST", body: JSON.stringify({ barcode: value, locationBin: activeBin, quantity }) },
      );
      const matched = result.matched === true;
      const message =
        result.message ||
        (matched ? "Catalog item counted." : "No catalog item found.");
      const matchedProduct = result.product || null;
      applyAuditUpdate(result.audit || resumedAudit);
      setLastScan({
        barcode: String(value),
        matched,
        message,
        sku: matchedProduct?.sku,
        title: matchedProduct?.marketplaceTitle || matchedProduct?.title,
        uom: matchedProduct?.uom,
        uomName: matchedProduct?.uomName,
        casePack: Number(matchedProduct?.casePack || matchedProduct?.uomQty || 1),
      });
      setCameraMessage(
        matched
          ? `✓ ${message} Ready for the next barcode.`
          : `Product not found: ${value}. Add details below.`,
      );
      if (!matched) {
        setManualUnknown({
          barcode: String(value),
          sku: "",
          title: "",
          // A manual SKU belongs to the same physical bin the counter is
          // currently working in unless they intentionally choose another.
          locationBin: activeBin,
          qty: String(quantity),
        });
        setManualQuickCreateClientId(crypto.randomUUID());
        setManualPhotoUrls([]);
        setCameraOpen(false);
        window.setTimeout(() => manualCreateRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
      }
      scannerFeedback(matched ? "success" : "unknown");
      setBarcode("");
      if (!cameraOpen) toast[matched ? "success" : "warning"](message);
      return `✓ ${message} Ready for the next barcode.`;
      // The mutation response already contains the saved audit; avoid a full state refresh.
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to save scan.";
      setCameraMessage(message);
      scannerFeedback("error");
      if (!cameraOpen) toast.error(message);
    } finally {
      setBusy(false);
    }
  };
  submitScanRef.current = submit;
  const beginQuickCreate = (draft?: Record<string, string>) => {
    const scannedDraft: Record<string, string> | null = !draft && lastScan && !lastScan.matched
      ? {
          barcode: lastScan.barcode,
          sku: "",
          title: "",
          locationBin: activeBin,
          qty: String(Math.max(1, Math.min(100000, Math.floor(Number(cameraScanQuantity) || 1)))),
        }
      : null;
    const nextDraft: Record<string, string> | null = draft || scannedDraft;
    if (!nextDraft?.barcode) return;
    const quickDraft: Record<string, string> = {
      ...nextDraft,
      uom: String(nextDraft.uom || "EA").trim().toUpperCase() || "EA",
      casePack: String(Math.max(1, Math.floor(Number(nextDraft.casePack || nextDraft.packQuantity || 1) || 1))),
    };
    const resumeScanner = Boolean(cameraOpen && lastScan && !lastScan.matched);
    setManualUnknown(quickDraft);
    setManualQuickCreateClientId(crypto.randomUUID());
    setManualPhotoUrls([]);
    setPhotoAnalysisStatus("idle");
    setQuickCreateResumeScanner(resumeScanner);
    setQuickCreatePhotoOpen(true);
    setCameraOpen(false);
    setCameraMessage(`Take product photos for ${quickDraft.barcode}, then create the draft SKU.`);
    quickCreatePhotoInputRef.current?.click();
  };
  const continueToFullCreate = async () => {
    if (!lastScan || lastScan.matched || cameraLookupBusy) return;
    const quantity = Math.max(1, Math.min(100000, Math.floor(Number(cameraScanQuantity) || 1)));
    setCameraLookupBusy(true);
    try {
      await submit(lastScan.barcode, quantity);
    } finally {
      setCameraLookupBusy(false);
    }
  };
  const toggleAuditTorch = async () => {
    const controls = scannerControlsRef.current;
    if (!controls?.torchAvailable) return;
    const next = !torchEnabled;
    try {
      await controls.setTorch(next);
      setTorchEnabled(next);
    } catch {
      toast.error("The camera light could not be changed.");
    }
  };
  const resetCameraScan = (message?: string) => {
    setLastScan(null);
    setBarcode("");
    setCameraLookupBusy(false);
    setCameraScanQuantity("1");
    scanRef.current = false;
    lastCameraScanRef.current = { value: "", at: 0 };
    setCameraMessage(message || (
      cameraMode === "bin"
        ? "Camera ready. Point at the next bin label."
        : activeBin
          ? `Counting in bin ${activeBin}. Point at the next product barcode.`
          : "Camera ready. Point at the next product barcode."
    ));
  };
  const closeCameraScanner = () => {
    setCameraOpen(false);
    resetCameraScan();
  };
  const confirmCameraScan = async () => {
    if (!lastScan || cameraLookupBusy) return;
    const quantity = Math.max(1, Math.min(100000, Math.floor(Number(cameraScanQuantity) || 0)));
    if (!(quantity > 0)) {
      setCameraMessage("Enter a quantity of at least 1.");
      return;
    }
    const candidate = lastScan;
    setCameraLookupBusy(true);
    try {
      const message = await submit(candidate.barcode, quantity);
      if (message && candidate.matched) resetCameraScan(message);
    } finally {
      setCameraLookupBusy(false);
    }
  };
  const flushOfflineScans = async () => {
    if (!resumedAudit?.id || !navigator.onLine || syncingOfflineScans) return;
    const all = readOfflineScans();
    const mine = all.filter((scan) => scan.auditId === String(resumedAudit.id));
    if (!mine.length) return;
    setSyncingOfflineScans(true);
    const remaining = all.filter((scan) => scan.auditId !== String(resumedAudit.id));
    let synced = 0;
    try {
      for (let index = 0; index < mine.length; index += 1) {
        const scan = mine[index];
        try {
          const result = await api<{ audit?: Record<string, unknown> }>(`/api/warehouse-audits/${encodeURIComponent(scan.auditId)}/scan`, { method: "POST", body: JSON.stringify({ barcode: scan.barcode, locationBin: scan.locationBin, quantity: scan.quantity || 1 }) });
          if (result.audit) applyAuditUpdate(result.audit);
          synced += 1;
        } catch {
          remaining.push(...mine.slice(index));
          break;
        }
      }
      writeOfflineScans(remaining);
      setOfflineScanCount(remaining.filter((scan) => scan.auditId === String(resumedAudit.id)).length);
      if (synced) { const message = `${synced} offline scan${synced === 1 ? "" : "s"} synced.`; if (cameraOpenRef.current) setCameraMessage(message); else toast.success(message); }
    } finally { setSyncingOfflineScans(false); }
  };
  useEffect(() => {
    const sync = () => { void flushOfflineScans(); };
    sync();
    window.addEventListener("online", sync);
    return () => window.removeEventListener("online", sync);
  }, [resumedAudit?.id]);
  const researchUnknownUpc = async () => {
    if (!resumedAudit || !manualUnknown || upcResearchBusy) return;
    setUpcResearchBusy(true);
    try {
      const result = await api<{
        audit?: Record<string, unknown>;
        matched?: boolean;
        product?: Record<string, unknown>;
        research?: Record<string, unknown>;
        message?: string;
      }>(
        `/api/warehouse-audits/${encodeURIComponent(String(resumedAudit.id))}/research-upc`,
        {
          method: "POST",
          body: JSON.stringify({ barcode: manualUnknown.barcode }),
        },
      );
      if (result.audit) applyAuditUpdate(result.audit);
      if (result.matched && result.product) {
        setManualUnknown(null);
        setLastScan({
          barcode: manualUnknown.barcode,
          matched: true,
          message: result.message || "Catalog item found.",
        });
        toast.success(result.message || "Catalog item found.");
        return;
      }
      const research = result.research || {};
      setUpcResearch(research);
      setManualUnknown((entry) =>
        entry
          ? {
              ...entry,
              title: entry.title || String(research.title || ""),
              brand: entry.brand || String(research.brand || ""),
              manufacturer:
                entry.manufacturer || String(research.manufacturer || ""),
              mfrPartNumber:
                entry.mfrPartNumber || String(research.mfrPartNumber || ""),
              vendorSku: entry.vendorSku || String(research.vendorSku || ""),
              category: entry.category || String(research.category || ""),
              shortDescription:
                entry.shortDescription ||
                String(research.shortDescription || ""),
              packQuantity:
                entry.packQuantity || String(research.packQuantity || ""),
              researchConfidence: String(
                Math.round(Number(research.confidence || 0) * 100),
              ),
            }
          : entry,
      );
      toast[research.found === true ? "success" : "warning"](
        result.message || "Online UPC research completed.",
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to research this UPC online.",
      );
    } finally {
      setUpcResearchBusy(false);
    }
  };
  const analyzeManualPhotos = async (photoDataUrls = manualPhotoUrls) => {
    const photos = photoDataUrls.filter(Boolean).slice(0, 2);
    if (photoAnalysisBusy || !photos.length) return;
    const requestId = photoAnalysisRequestRef.current + 1;
    photoAnalysisRequestRef.current = requestId;
    setPhotoAnalysisBusy(true);
    setPhotoAnalysisStatus("analyzing");
    try {
      const result = await api<{ suggestion?: Record<string, unknown> }>(
        "/api/warehouse/photo-suggestions",
        { method: "POST", body: JSON.stringify({ photoDataUrls: photos }) },
      );
      if (requestId !== photoAnalysisRequestRef.current) return;
      const suggestion = result.suggestion || {};
      setManualUnknown((entry) =>
        entry
          ? {
              ...entry,
              photoDataUrl: photos[0] || "",
              title: entry.title || String(suggestion.title || ""),
              brand: entry.brand || String(suggestion.brand || ""),
              manufacturer:
                entry.manufacturer || String(suggestion.manufacturer || ""),
              mfrPartNumber:
                entry.mfrPartNumber || String(suggestion.mfrPartNumber || ""),
              vendorSku: entry.vendorSku || String(suggestion.vendorSku || ""),
              category: entry.category || String(suggestion.category || ""),
              shortDescription:
                entry.shortDescription ||
                String(suggestion.shortDescription || ""),
              packQuantity:
                entry.packQuantity || String(suggestion.packQuantity || ""),
              analysisConfidence: String(
                Math.round(Number(suggestion.confidence || 0) * 100),
              ),
              analysisVisibleText: String(suggestion.visibleText || ""),
            }
          : entry,
      );
      toast.success(
        `Package details suggested from ${photos.length} photo${photos.length === 1 ? "" : "s"}. Review them before creating the SKU.`,
      );
      setPhotoAnalysisStatus("ready");
    } catch (error) {
      if (requestId !== photoAnalysisRequestRef.current) return;
      setPhotoAnalysisStatus("error");
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to analyze this product photo.",
      );
    } finally {
      if (requestId === photoAnalysisRequestRef.current) setPhotoAnalysisBusy(false);
    }
  };
  const saveManualPhoto = (photoDataUrl: string) => {
    if (!photoDataUrl) return;
    photoAnalysisRequestRef.current += 1;
    setManualPhotoUrls((photos) => [...photos, photoDataUrl].slice(-8));
    setManualUnknown((entry) =>
      entry && !entry.photoDataUrl ? { ...entry, photoDataUrl } : entry,
    );
    setPhotoAnalysisStatus("idle");
  };
  const removeManualPhoto = (index: number) => {
    photoAnalysisRequestRef.current += 1;
    setPhotoAnalysisStatus("idle");
    setManualPhotoUrls((photos) => {
      const next = photos.filter((_, photoIndex) => photoIndex !== index);
      setManualUnknown((entry) =>
        entry ? { ...entry, photoDataUrl: next[0] || "" } : entry,
      );
      return next;
    });
  };
  const readManualPhotos = async (files?: FileList | null) => {
    if (!files?.length) return;
    const remaining = Math.max(0, 8 - manualPhotoUrls.length);
    for (const file of Array.from(files).slice(0, remaining)) {
      try {
        const prepared = /^image\//i.test(file.type) ? await compressEvidenceImage(file) : file;
        if (prepared.size > 3 * 1024 * 1024) {
          toast.error(`${file.name} is larger than 3 MB and was skipped.`);
          continue;
        }
        saveManualPhoto(await blobDataUrl(prepared));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Unable to prepare ${file.name}.`);
      }
    }
  };
  const closeQuickCreatePhotoCapture = () => {
    setQuickCreatePhotoOpen(false);
    setQuickCreateResumeScanner(false);
    if (quickCreateResumeScanner) {
      setManualUnknown(null);
      setManualPhotoUrls([]);
      setManualQuickCreateClientId("");
      setCameraOpen(true);
    }
  };
  const saveManualQuickCreatedProduct = async () => {
    if (!resumedAudit || !manualUnknown || quickCreateBusy) return;
    if (!manualPhotoUrls.length) return toast.error("Take at least one product photo before quick create.");
    setQuickCreateBusy(true);
    try {
      const result = await api<{ audit?: Record<string, unknown>; product?: { sku?: string }; message?: string }>(
        `/api/warehouse-audits/${encodeURIComponent(String(resumedAudit.id))}/quick-item`,
        { method: "POST", body: JSON.stringify({ barcode: manualUnknown.barcode, qty: Math.max(1, Number(manualUnknown.qty) || 1), locationBin: manualUnknown.locationBin || activeBin, uom: manualUnknown.uom || "EA", casePack: Math.max(1, Number(manualUnknown.casePack) || 1), photoDataUrls: manualPhotoUrls.slice(0, 8), clientActionId: manualQuickCreateClientId || crypto.randomUUID(), user: operatorName }) },
      );
      if (result.audit) applyAuditUpdate(result.audit);
      const message = result.message || `${String(result.product?.sku || "Draft SKU")} quick-created.`;
      const resumeScanner = quickCreateResumeScanner;
      setQuickCreatePhotoOpen(false);
      setQuickCreateResumeScanner(false);
      setManualUnknown(null);
      setManualPhotoUrls([]);
      setManualQuickCreateClientId("");
      resetCameraScan(`${message} Ready for the next barcode.`);
      if (resumeScanner) setCameraOpen(true);
      scannerFeedback("success");
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to quick-create this product.");
    } finally {
      setQuickCreateBusy(false);
    }
  };
  const saveManualUnknown = async () => {
    if (!resumedAudit || !manualUnknown) return;
    setBusy(true);
    try {
      const result = await api<{
        audit?: Record<string, unknown>;
        message?: string;
      }>(
        `/api/warehouse-audits/${encodeURIComponent(String(resumedAudit.id))}/manual-item`,
        {
          method: "POST",
          body: JSON.stringify({ ...manualUnknown, photoDataUrls: manualPhotoUrls, user: "Luis" }),
        },
      );
      applyAuditUpdate(result.audit || resumedAudit);
      setManualUnknown(null);
      setManualPhotoUrls([]);
      setManualQuickCreateClientId("");
      toast.success(result.message || "Catalog SKU created from audit.");
      // The mutation response already contains the saved audit; avoid a full state refresh.
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to create catalog SKU.",
      );
    } finally {
      setBusy(false);
    }
  };
  const startManualSkuCreation = async (draft = manualUnknown) => {
    setUpcResearch(null);
    if (!resumedAudit || !draft || manualSkuLoading) return;
    if (!String(draft.sku || "").trim()) {
      setManualSkuLoading(true);
      try {
        const result = await api<{ sku?: string }>(`/api/warehouse-audits/${encodeURIComponent(String(resumedAudit.id))}/next-sku`, { method: "POST" });
        const generatedSku = String(result.sku || "").trim();
        if (!generatedSku) throw new Error("Automatic SKU generation did not return a SKU.");
        setManualUnknown((entry) => entry && entry.barcode === draft.barcode && String(entry.unknownLocationBin || "") === String(draft.unknownLocationBin || "")
          ? { ...entry, sku: generatedSku }
          : entry);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Unable to generate the next DataPlus SKU.");
        return;
      } finally {
        setManualSkuLoading(false);
      }
    }
    window.setTimeout(() => {
      manualTitleRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      manualTitleRef.current?.focus();
    }, 0);
  };
  const reopenUnknownSku = async (item: Record<string, unknown>, mode: "quick" | "full" = "full") => {
    if (resumedAudit?.status !== "in_progress" || item.createdProductSku || busy || upcResearchBusy || photoAnalysisBusy) return;
    const draft = {
      barcode: String(item.barcode || ""),
      sku: String(item.manualSku || ""),
      title: String(item.manualTitle || ""),
      unknownLocationBin: String(item.locationBin || ""),
      locationBin: String(item.locationBin || ""),
      qty: String(Math.max(1, Number(item.count) || 1)),
    };
    if (mode === "quick") {
      beginQuickCreate(draft);
      return;
    }
    setManualUnknown(draft);
    setManualQuickCreateClientId(crypto.randomUUID());
    setManualPhotoUrls([]);
    setPhotoAnalysisStatus("idle");
    setCameraOpen(false);
    window.setTimeout(() => manualCreateRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    await startManualSkuCreation(draft);
  };
  const shareAuditLink = async () => {
    if (!resumedAudit?.id) return;
    const url = new URL(`/warehouse/${mobile ? "mobile/" : ""}audits/${encodeURIComponent(String(resumedAudit.id))}`, window.location.origin).href;
    if (navigator.share) {
      try {
        await navigator.share({ title: `Warehouse audit ${String(resumedAudit.auditNumber || "")}`, url });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Audit link copied. The recipient will need access to this audit.");
    } catch {
      setShareAuditUrl(url);
    }
  };
  const approveClearBin = async () => {
    if (!resumedAudit || !clearBinTarget || !clearBinReason.trim() || !clearBinPin.trim() || clearBinBusy) return;
    setClearBinBusy(true);
    try {
      const result = await api<{ audit: Record<string, unknown> }>(`/api/warehouse-audits/${encodeURIComponent(String(resumedAudit.id))}/clear-bin`, {
        method: "POST", body: JSON.stringify({ locationBin: clearBinTarget, reason: clearBinReason.trim(), adminPin: clearBinPin, adminUserId: scannerSettings.activeSystemUserId }),
      });
      applyAuditUpdate(result.audit);
      setActiveBin((selected) => selected === clearBinTarget ? "" : selected);
      setClearBinTarget("");
      toast.success("Selected bin cleared with administrator approval.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to clear the selected bin.");
    } finally { setClearBinBusy(false); setClearBinPin(""); }
  };
  const openInventoryAction = async () => {
    if (!resumedAudit) return;
    setDispositionOpen(true);
    setActionPreview(null);
    setActionPreviewError("");
    setReturnDespiteDemand(false);
    if (String(resumedAudit.reason || "") === "ebay_one_time_listing") {
      setDispositionType("stock_here");
      setActionPreview({ totalUsableQty: 0, affectedOrderCount: 0, orders: [], lines: [] });
      setActionPreviewLoading(false);
      return;
    }
    if (String(resumedAudit.reason || "") === "purchase_order_receipt" && resumedAudit.linkedPurchaseOrderId) {
      setActionPreviewLoading(false);
      return;
    }
    setActionPreviewLoading(true);
    try {
      const result = await api<{ preview?: Record<string, unknown> }>(
        `/api/warehouse-audits/${encodeURIComponent(String(resumedAudit.id))}/action-preview`,
      );
      const preview = result.preview || {};
      setActionPreview(preview);
      if (Number(preview.totalUsableQty || 0) > 0) setDispositionType("fulfill_orders");
    } catch (error) {
      setActionPreviewError(error instanceof Error ? error.message : "Unable to check open order demand.");
    } finally {
      setActionPreviewLoading(false);
    }
  };
  const complete = async () => {
    if (!resumedAudit) return;
    if (isReceivingAuditReason(resumedAudit.reason) && !(Array.isArray(resumedAudit.receivingDocuments) && resumedAudit.receivingDocuments.some((document) => String((document as Record<string, unknown>).documentType || "") === "packing_slip"))) {
      toast.error("Add at least one packing-slip photo or file before finishing this receipt.");
      return;
    }
    setBusy(true);
    try {
      if (String(resumedAudit.reason || "") === "purchase_order_receipt" && resumedAudit.linkedPurchaseOrderId) {
        const expectedLines = Array.isArray(resumedAudit.purchaseOrderExpectedLines) ? resumedAudit.purchaseOrderExpectedLines as Array<Record<string, unknown>> : [];
        const identifierKeys = (value: unknown) => {
          const key = String(value || "").replace(/[^0-9a-z]/gi, "").toLowerCase();
          return key ? [...new Set([key, /^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, "") : key])] : [];
        };
        const matchingExpected = (line: Record<string, unknown>) => expectedLines.filter((expected) => {
          const sku = new Set([line.sku, line.selectedSupplierSku].flatMap(identifierKeys));
          if (identifierKeys(expected.sku).some((key) => sku.has(key))) return true;
          const vendor = new Set([line.selectedVendorSku, line.vendorSku].flatMap(identifierKeys));
          if (identifierKeys(expected.vendorItemNumber).some((key) => vendor.has(key))) return true;
          const upc = new Set([line.selectedSupplierUpc, line.barcode, line.upc].flatMap(identifierKeys));
          return identifierKeys(expected.upc).some((key) => upc.has(key));
        });
        const countedLines = (Array.isArray(resumedAudit.lines) ? resumedAudit.lines as Array<Record<string, unknown>> : []).filter((line) => Number(line.countedQty || 0) > 0 && String(line.reviewStatus || "") !== "excluded");
        const unmatched = countedLines.filter((line) => !matchingExpected(line).length);
        if (unmatched.length) throw new Error(`${unmatched.slice(0, 5).map((line) => String(line.sku || line.barcode || "Unknown item")).join(", ")} ${unmatched.length === 1 ? "is" : "are"} not on this purchase order. Remove the count or receive the shipment as an external PO.`);
        const allocatedByExpectedId = new Map<string, number>();
        const items: Array<Record<string, unknown>> = [];
        for (const line of countedLines) {
          let remaining = Number(line.countedQty || 0);
          const candidates = matchingExpected(line);
          for (const expected of candidates) {
            if (remaining <= 0) break;
            const expectedId = String(expected.id || expected.lineIndex || expected.sku || "");
            const available = Math.max(0, Number(expected.expectedQty || 0) - Number(allocatedByExpectedId.get(expectedId) || 0));
            const qtyReceived = Math.min(remaining, available);
            if (qtyReceived <= 0) continue;
            allocatedByExpectedId.set(expectedId, Number(allocatedByExpectedId.get(expectedId) || 0) + qtyReceived);
            items.push({
              lineIndex: Number(expected.lineIndex),
              routeId: String(expected.routeId || ""),
              sku: String(expected.sku || line.sku || ""),
              qtyReceived,
              locationBin: String(line.locationBin || ""),
              varianceStatus: qtyReceived === Number(expected.expectedQty || 0) ? "none" : "quantity_variance",
              varianceNote: qtyReceived === Number(expected.expectedQty || 0) ? "" : `Scanned receipt allocated ${qtyReceived} of ${Number(expected.expectedQty || 0)} open units.`,
            });
            remaining -= qtyReceived;
          }
          if (remaining > 0) throw new Error(`${String(line.sku || line.barcode || "This item")} has ${remaining} scanned unit${remaining === 1 ? "" : "s"} above the open quantity on ${String(resumedAudit.linkedPurchaseOrderNumber || "this PO")}. Correct the count before posting.`);
        }
        const received = await api<{ purchaseOrder?: Record<string, unknown>; receipt?: Record<string, unknown> }>(`/api/purchase-orders/${encodeURIComponent(String(resumedAudit.linkedPurchaseOrderId))}/receive`, {
          method: "POST",
          body: JSON.stringify({ mode: "final", warehouseId: resumedAudit.warehouseId, items, note: dispositionNote || `Received through ${String(resumedAudit.auditNumber || "inbound receiving")}`, user: operatorName, sourceAuditId: resumedAudit.id, sourceAuditNumber: resumedAudit.auditNumber }),
        });
        const finalized = await api<{ audit?: Record<string, unknown>; message?: string }>(`/api/warehouse-audits/${encodeURIComponent(String(resumedAudit.id))}/complete`, {
          method: "POST",
          body: JSON.stringify({ user: operatorName, dispositionType: "purchase_order_receipt", sourceReceiptId: received.receipt?.id || "", sourceReceiptNumber: received.receipt?.receiptNumber || "", dispositionNote }),
        });
        setActive(finalized.audit || null);
        setDispositionOpen(false);
        toast.success(finalized.message || "Purchase order receipt completed.");
        await load();
        return;
      }
      const result = await api<{
        audit?: Record<string, unknown>;
        message?: string;
      }>(
        `/api/warehouse-audits/${encodeURIComponent(String(resumedAudit.id))}/complete`,
        { method: "POST", body: JSON.stringify({ user: "Luis", dispositionType, destinationWarehouseId, dispositionNote, returnDespiteDemand }) },
      );
      setActive(result.audit || null);
      setDispositionOpen(false);
      toast.success(result.message || "Warehouse audit completed.");
      await load();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to complete audit.",
      );
    } finally {
      setBusy(false);
    }
  };
  const returnToCount = async () => {
    if (!resumedAudit) return;
    const note = window.prompt("What should the counter verify before resubmitting?", "") || "";
    setBusy(true);
    try {
      const result = await api<{ audit?: Record<string, unknown>; message?: string }>(
        `/api/warehouse-audits/${encodeURIComponent(String(resumedAudit.id))}/return-to-count`,
        { method: "POST", body: JSON.stringify({ user: "Luis", note }) },
      );
      setActive(result.audit || null);
      toast.success(result.message || "Warehouse audit returned to counting.");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to return this audit to counting.");
    } finally {
      setBusy(false);
    }
  };
  const auditLineKey = (line: Record<string, unknown>) => String(line.id || `${String(line.productId || line.sku || "")}::${String(line.locationBin || "")}`);
  const openCountEdit = (line: Record<string, unknown>) => {
    setCountEditLine(line);
    setCountEditBin(String(line.locationBin || ""));
    setCountEditValue(String(Math.max(0, Number(line.countedQty || 0))));
    setCountEditNote("");
  };
  const saveCountEdit = async () => {
    if (!resumedAudit || !countEditLine) return;
    const countedQty = Number(countEditValue);
    if (!Number.isInteger(countedQty) || countedQty < 0) {
      toast.error("Enter a whole-number count of zero or more.");
      return;
    }
    setCountEditBusy(true);
    try {
      const result = await api<{ audit?: Record<string, unknown>; message?: string }>(
        `/api/warehouse-audits/${encodeURIComponent(String(resumedAudit.id))}/lines/${encodeURIComponent(auditLineKey(countEditLine))}/count`,
        { method: "POST", body: JSON.stringify({ countedQty, locationBin: countEditBin, note: countEditNote, user: "Luis" }) },
      );
      applyAuditUpdate(result.audit || resumedAudit);
      setCountEditLine(null);
      toast.success(result.message || "Audit count adjusted.");
      // The saved audit response already contains the updated item.
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to adjust the count.");
    } finally {
      setCountEditBusy(false);
    }
  };
  const openPurposeEditor = () => {
    setPurposeDraft(String(resumedAudit?.reason || ""));
    setReceivingSupplier(String(resumedAudit?.supplierName || ""));
    setReceivingSupplierId(String(resumedAudit?.supplierId || receivingSupplierId || ""));
    setExternalPurchaseOrderNumber(String(resumedAudit?.externalPurchaseOrderNumber || ""));
    setPurposeEditorOpen(true);
  };
  const saveAuditPurpose = async () => {
    if (!resumedAudit?.id || !purposeDraft) return;
    setPurposeSaving(true);
    try {
      const result = await api<{ audit?: Record<string, unknown>; message?: string }>(
        `/api/warehouse-audits/${encodeURIComponent(String(resumedAudit.id))}`,
        { method: "PATCH", body: JSON.stringify({ reason: purposeDraft, supplierId: isReceivingAuditReason(purposeDraft) ? receivingSupplierId : "", supplierName: isReceivingAuditReason(purposeDraft) ? receivingSupplier : "", externalPurchaseOrderNumber: purposeDraft === "external_po_receipt" ? externalPurchaseOrderNumber.trim() : "", user: auditOwner || "Luis" }) },
      );
      applyAuditUpdate(result.audit || resumedAudit);
      setPurposeEditorOpen(false);
      toast.success(result.message || "Audit purpose saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save the audit purpose.");
    } finally {
      setPurposeSaving(false);
    }
  };
  const openItemNote = (line: Record<string, unknown>) => { setNoteItem(line); setItemNote(String(line.note || "")); };
  const saveItemNote = async () => {
    if (!resumedAudit || !noteItem || noteSaving) return;
    setNoteSaving(true);
    try {
      const kind = noteItem.auditItemKind === "unknown" ? "unknown" : "known";
      const lineKey = kind === "unknown" ? `${String(noteItem.barcode || "")}::${String(noteItem.locationBin || "")}` : auditLineKey(noteItem);
      const result = await api<{ audit: Record<string, unknown>; message?: string }>(`/api/warehouse-audits/${encodeURIComponent(String(resumedAudit.id))}/item-notes`, { method: "POST", body: JSON.stringify({ kind, lineKey, note: itemNote }) });
      applyAuditUpdate(result.audit); setNoteItem(null); toast.success(result.message || "Item note saved.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save item note."); }
    finally { setNoteSaving(false); }
  };
  const itemNoteButton = (line: Record<string, unknown>) => <Button size="sm" variant="ghost" className={line.note ? "text-primary" : "text-muted-foreground"} onClick={() => openItemNote(line)} aria-label={`${line.note ? "View or edit" : "Add"} note for ${String(line.sku || line.barcode || "item")}`}><MessageSquare className="size-4" />{line.note ? "Note" : "Add note"}</Button>;
  const current = resumedAudit;
  const lines = sortWarehouseAuditRows(Array.isArray(current?.lines) ? current.lines as Array<Record<string, unknown>> : [], itemSort, true);
  const unknowns = sortWarehouseAuditRows(Array.isArray(current?.unknownBarcodes) ? current.unknownBarcodes as Array<Record<string, unknown>> : [], itemSort, true);
  const isReceivingAudit = isReceivingAuditReason(current?.reason);
  const isEbayOneTimeAudit = String(current?.reason || "") === "ebay_one_time_listing";
  const receivingDocuments = Array.isArray(current?.receivingDocuments) ? current.receivingDocuments as Array<Record<string, unknown>> : [];
  const hasPackingSlip = receivingDocuments.some((document) => String(document.documentType || "") === "packing_slip");
  const isLinkedPurchaseOrderReceipt = String(current?.reason || "") === "purchase_order_receipt" && Boolean(current?.linkedPurchaseOrderId);
  const receivingReview = current?.packingSlipReview && typeof current.packingSlipReview === "object" ? current.packingSlipReview as Record<string, unknown> : null;
  const receivingReviewLines = Array.isArray(receivingReview?.lines) ? receivingReview.lines as Array<Record<string, unknown>> : [];
  const purchaseOrderExpectedLines = Array.isArray(current?.purchaseOrderExpectedLines) ? current.purchaseOrderExpectedLines as Array<Record<string, unknown>> : [];
  const receivingExpectedLines = purchaseOrderExpectedLines.length ? purchaseOrderExpectedLines : receivingReviewLines;
  const receivingIdentifierKeys = (value: unknown) => {
    const key = String(value || "").replace(/[^0-9a-z]/gi, "").toLowerCase();
    if (!key) return [];
    return [...new Set([key, /^\d+$/.test(key) ? key.replace(/^0+(?=\d)/, "") : key].filter(Boolean))];
  };
  const receivingLineMatch = (auditLine: Record<string, unknown>, poLine: Record<string, unknown>) => {
    const skuKeys = new Set([auditLine.sku, auditLine.selectedSupplierSku].flatMap(receivingIdentifierKeys));
    if (receivingIdentifierKeys(poLine.sku).some((key) => skuKeys.has(key))) return "sku";
    const vendorKeys = new Set([auditLine.selectedVendorSku, auditLine.vendorSku].flatMap(receivingIdentifierKeys));
    const poVendorKeys = receivingIdentifierKeys(poLine.vendorItemNumber);
    if (vendorKeys.size && poVendorKeys.some((key) => vendorKeys.has(key))) return "vendor_sku";
    const upcKeys = new Set([auditLine.selectedSupplierUpc, auditLine.barcode, auditLine.upc].flatMap(receivingIdentifierKeys));
    return receivingIdentifierKeys(poLine.upc).some((key) => upcKeys.has(key)) ? "upc" : "";
  };
  const baseAuditItems = [...(Array.isArray(current?.lines) ? current.lines as Array<Record<string, unknown>> : []).map(row => ({ ...row, auditItemKind: "known" })), ...(Array.isArray(current?.unknownBarcodes) ? current.unknownBarcodes as Array<Record<string, unknown>> : []).map(row => ({ ...row, auditItemKind: "unknown" }))];
  const matchedReceivingIds = new Set<string>();
  const receivingAuditItems = baseAuditItems.map((row) => {
    const poLines = receivingExpectedLines.filter((candidate) => receivingLineMatch(row, candidate));
    if (!poLines.length) return row;
    poLines.forEach((poLine) => matchedReceivingIds.add(String(poLine.id)));
    const poLine = poLines.length === 1 ? poLines[0] : {
      ...poLines[0],
      id: poLines.map((candidate) => String(candidate.id)).join("::"),
      expectedQty: poLines.reduce((sum, candidate) => sum + Number(candidate.expectedQty ?? candidate.quantity ?? 0), 0),
      orderedQty: poLines.reduce((sum, candidate) => sum + Number(candidate.orderedQty ?? candidate.quantity ?? 0), 0),
    };
    return { ...row, receivingPoLine: poLine, receivingPoLines: poLines, receivingMatchBasis: receivingLineMatch(row, poLines[0]) };
  });
  const expectedOnlyItems = receivingExpectedLines.filter((line) => !matchedReceivingIds.has(String(line.id))).map((line) => ({ ...line, auditItemKind: "po_expected", receivingPoLine: line, receivingMatchBasis: "", barcode: line.upc, selectedVendorSku: line.vendorItemNumber, selectedManufacturerSku: line.manufacturerSku, title: line.description || line.title, countedQty: 0 }));
  const sortedItems = sortWarehouseAuditRows([...receivingAuditItems, ...expectedOnlyItems], itemSort, true);
  const auditStatus = String(current?.status || "");
  const foundStockLines = lines.filter((line) => String(line.source || "").includes("found-stock") || Boolean(line.foundStock));
  const latestFoundStockImport = Array.isArray(current?.foundStockImports) ? current?.foundStockImports[0] as Record<string, unknown> : null;
  const latestFoundStockSummary = latestFoundStockImport?.summary && typeof latestFoundStockImport.summary === "object" ? latestFoundStockImport.summary as Record<string, unknown> : null;
  const auditDisposition = current?.disposition && typeof current.disposition === "object" ? current.disposition as Record<string, unknown> : null;
  const marketplaceShadows = Array.isArray(auditDisposition?.marketplaceShadows) ? auditDisposition.marketplaceShadows as Array<Record<string, unknown>> : [];
  const transferDestinations = auditWarehouses.filter((item) =>
    String(item.id || "") !== String(current?.warehouseId || "") &&
    warehouseTypeOption(item.warehouseType).isPhysical &&
    String(item.inventorySourceType || "").toLowerCase() !== "supplier_feed",
  );
  const actionPreviewLines = Array.isArray(actionPreview?.lines)
    ? actionPreview.lines as Array<Record<string, unknown>>
    : [];
  const missingReturnSupplierLines = actionPreviewLines.filter((line) =>
    Number(line.countedQty || 0) > 0 && Number(line.supplierCount || 0) !== 1 && !String(line.selectedSupplierName || "").trim(),
  );
  const compatibleOrders = Array.isArray(actionPreview?.orders)
    ? actionPreview.orders as Array<Record<string, unknown>>
    : [];
  const compatibleDemandQty = Number(actionPreview?.totalUsableQty || 0);
  const compatibleOrderCount = Number(actionPreview?.affectedOrderCount || compatibleOrders.length || 0);
  const multipleSupplierActionLines = Number(actionPreview?.multipleSupplierLineCount || 0);
  const finishActionBlocked = busy
    || (isReceivingAudit && !hasPackingSlip)
    || (!isLinkedPurchaseOrderReceipt && (
      actionPreviewLoading
      || Boolean(actionPreviewError)
      || (dispositionType === "transfer" && !destinationWarehouseId)
      || (dispositionType === "return_to_supplier" && (missingReturnSupplierLines.length > 0 || (compatibleDemandQty > 0 && !returnDespiteDemand)))
    ));
  const dispositionReturns = Array.isArray(auditDisposition?.supplierReturns)
    ? auditDisposition.supplierReturns as Array<Record<string, unknown>>
    : [];
  const dispositionOrders = Array.isArray(auditDisposition?.routedOrders)
    ? auditDisposition.routedOrders as Array<Record<string, unknown>>
    : [];
  const receivingSupplierPicker = (allowCreate = false) => <div className="flex min-w-0 flex-wrap gap-2">
    <Select value={receivingSupplierId} onValueChange={selectReceivingSupplier}>
      <SelectTrigger className="min-w-56 flex-1"><SelectValue placeholder="Select supplier profile" /></SelectTrigger>
      <SelectContent>{auditVendors.map((vendor) => <SelectItem key={vendor.id} value={vendor.id}>{vendor.name}{vendor.code ? ` (${vendor.code})` : ""}</SelectItem>)}</SelectContent>
    </Select>
    {allowCreate && <Button type="button" variant="outline" onClick={() => setCreateVendorOpen(true)}><Plus className="size-4" /> New vendor</Button>}
  </div>
  const createVendorDialog = <VendorCreateDialog open={createVendorOpen} onOpenChange={setCreateVendorOpen} context="external-receipt" onCreated={(vendor) => {
    setAuditVendors((current) => [vendor, ...current.filter((row) => row.id !== vendor.id)])
    setReceivingSupplierId(vendor.id)
    setReceivingSupplier(vendor.name)
  }} />
  if (createOnly)
    return (
      <><Card>
        <CardHeader>
          <CardTitle className="text-base">Start warehouse audit</CardTitle>
          <CardDescription>
            Create a separate audit workspace for a warehouse and its assigned
            counter.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Field label="Warehouse">
            {auditWarehouses.length ? (
              <Select
                value={String(selectedCreateWarehouse?.id || warehouse)}
                onValueChange={setWarehouse}
              >
                <SelectTrigger className="min-w-56">
                  <SelectValue placeholder="Select warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {auditWarehouses.map((item) => (
                    <SelectItem key={String(item.id || item.name)} value={String(item.id || item.name || "")}>
                      {String(item.name || "Warehouse")}{item.code ? ` (${String(item.code)})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={warehouse}
                onChange={(event) => setWarehouse(event.target.value)}
                placeholder="Staten Island"
              />
            )}
          </Field>
          <Field label="Assigned counter">
            <Input
              value={auditOwner}
              onChange={(event) => setAuditOwner(event.target.value)}
              placeholder="Team member name"
            />
          </Field>
          <Field label="Audit reason">
            <Select value={auditReason} onValueChange={setAuditReason}>
              <SelectTrigger className="min-w-56"><SelectValue /></SelectTrigger>
              <SelectContent>{warehouseAuditReasonOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {isReceivingAuditReason(auditReason) && <Field label="Supplier">{receivingSupplierPicker(auditReason === "external_po_receipt")}</Field>}
          {auditReason === "external_po_receipt" && <Field label="External PO number"><Input value={externalPurchaseOrderNumber} onChange={(event) => setExternalPurchaseOrderNumber(event.target.value)} placeholder="PO number from the other system" /></Field>}
          <Button
            disabled={busy || !warehouse.trim() || !auditOwner.trim() || (isReceivingAuditReason(auditReason) && !receivingSupplierId) || (auditReason === "external_po_receipt" && !externalPurchaseOrderNumber.trim())}
            onClick={() => void create()}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create audit
          </Button>
        </CardContent>
      </Card>{createVendorDialog}</>
    );
  if (auditId && auditsLoading) {
    return <Card><CardContent className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading warehouse audit...</CardContent></Card>;
  }
  if (auditId && !current) {
    return <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Audit not found</AlertTitle><AlertDescription>This warehouse audit could not be loaded. Return to the audit register and try again.</AlertDescription></Alert>;
  }
  return (
    <><Card className="warehouse-audit-panel">
      {(!mobile || !current) && <CardHeader>
        <CardTitle className="text-base">Warehouse audit</CardTitle>
        <CardDescription>
          Start a count, scan UPCs with a phone camera or keyboard-wedge
          scanner, then apply verified inventory counts.
        </CardDescription>
      </CardHeader>}
      <CardContent className="grid gap-3">
        {!current ? (
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Warehouse">
              <Input
                value={warehouse}
                onChange={(event) => setWarehouse(event.target.value)}
              />
            </Field>
            <Field label="Audit reason">
              <Select value={auditReason} onValueChange={setAuditReason}>
                <SelectTrigger className="min-w-56"><SelectValue /></SelectTrigger>
                <SelectContent>{warehouseAuditReasonOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            {isReceivingAuditReason(auditReason) && <Field label="Supplier">{receivingSupplierPicker(auditReason === "external_po_receipt")}</Field>}
            {auditReason === "external_po_receipt" && <Field label="External PO number"><Input value={externalPurchaseOrderNumber} onChange={(event) => setExternalPurchaseOrderNumber(event.target.value)} placeholder="PO number from the other system" /></Field>}
            <Button
              disabled={busy || !warehouse.trim() || (isReceivingAuditReason(auditReason) && !receivingSupplierId) || (auditReason === "external_po_receipt" && !externalPurchaseOrderNumber.trim())}
              onClick={() => void create()}
            >
              Start warehouse audit
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col items-stretch gap-3 rounded-md border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{String(current.auditNumber)}</p>
                <p className="text-xs text-muted-foreground">
                  {String(current.warehouseName)} · {numberLabel(lines.length)}{" "}
                  catalog SKUs counted · {numberLabel(unknowns.length)} unknown
                  UPCs
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge variant={auditStatus === "completed" ? "secondary" : auditStatus === "pending_review" ? "outline" : "default"}>{auditStatus === "pending_review" ? "Action required" : auditStatus === "completed" ? "Applied" : "Counting"}</Badge>
                  {warehouseAuditReasonLabel(current.reason, current.reasonLabel) ? (
                    <Badge variant="outline">{warehouseAuditReasonLabel(current.reason, current.reasonLabel)}</Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-600 dark:bg-amber-950/50 dark:text-amber-100"><AlertTriangle className="mr-1 size-3" /> Reason missing</Badge>
                  )}
                  {String(current.externalPurchaseOrderNumber || "") && <Badge variant="outline">External PO {String(current.externalPurchaseOrderNumber)}</Badge>}
                  {String(current.linkedPurchaseOrderNumber || "") && <Badge variant="outline">DataPlus PO {String(current.linkedPurchaseOrderNumber)}</Badge>}
                  {auditDisposition && <Badge variant="secondary">{String(auditDisposition.label || "Inventory outcome applied")}</Badge>}
                  {Boolean(auditDisposition?.supplierReturnNumber) && <Badge variant="outline">{String(auditDisposition?.supplierReturnNumber)} draft</Badge>}
                  {offlineScanCount > 0 && <Badge variant="outline">{syncingOfflineScans ? "Syncing offline scans" : `${offlineScanCount} scan${offlineScanCount === 1 ? "" : "s"} queued offline`}</Badge>}
                  {auditStatus === "pending_review" && <span className="text-xs text-muted-foreground">{isReceivingAudit ? "Shipment scan complete · verify the packing slip and post the receipt" : "Count complete · choose what happens to the inventory"}</span>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:w-auto">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || auditStatus !== "in_progress"}
                  onClick={() => {
                    setCameraMode("product");
                    setLastScan(null);
                    setCameraScanQuantity("1");
                    scanRef.current = false;
                    setCameraStreamState("opening");
                    setCameraAttempt((attempt) => attempt + 1);
                    setCameraMessage(
                      activeBin ? `Counting in bin ${activeBin}. Point at the next product barcode.` : "Camera ready. Point it at the next product barcode.",
                    );
                    setCameraOpen(true);
                  }}
                >
                  <Camera className="size-4" /> Use phone camera
                </Button>
                {auditStatus === "in_progress" && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setCameraMode("bin"); setLastScan(null); scanRef.current = false; setCameraStreamState("opening"); setCameraAttempt((attempt) => attempt + 1); setCameraMessage("Scan the shelf or bin label now."); setCameraOpen(true); }}><ScanBarcode className="size-4" /> Scan bin</Button>}
                  {["in_progress", "pending_review"].includes(auditStatus) && <Button size="sm" disabled={busy || !lines.length || (isReceivingAudit && !hasPackingSlip)} title={isReceivingAudit && !hasPackingSlip ? "Add a packing slip before finishing this receipt" : undefined} onClick={() => void openInventoryAction()}><ArrowRight className="size-4" /> {isReceivingAudit ? "Finish receipt" : isEbayOneTimeAudit ? "Create shadows" : "Finish count"}</Button>}
                {auditStatus === "pending_review" && <Button size="sm" variant="outline" disabled={busy} onClick={() => void returnToCount()}><Play className="size-4" /> Continue counting</Button>}
                {auditStatus === "completed" && String(current.reason || "") === "ebay_one_time_listing" && <Button size="sm" disabled={ebayShadowLaunchBusy} onClick={() => void launchAuditShadowsOnEbay()}>{ebayShadowLaunchBusy ? <Loader2 className="size-4 animate-spin" /> : <Store className="size-4" />} Launch shadows</Button>}
                <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline"><MoreHorizontal className="size-4" /> More</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setBinLabelsOpen(true)}><Printer className="size-4" /> Print bin labels</DropdownMenuItem><DropdownMenuItem onSelect={() => void shareAuditLink()}><Share2 className="size-4" /> Share audit link</DropdownMenuItem>{activeBin && auditStatus === "in_progress" && <DropdownMenuItem disabled={busy || clearBinBusy} onSelect={requestClearBin}><X className="size-4" /> Clear bin</DropdownMenuItem>}{!mobile && desktopAuditTools && <DropdownMenuItem onSelect={() => setAuditToolsOpen(true)}><FileUp className="size-4" /> Import stock / eBay tools</DropdownMenuItem>}{!isLinkedPurchaseOrderReceipt && <DropdownMenuItem onSelect={openPurposeEditor}><Pencil className="size-4" /> Edit purpose</DropdownMenuItem>}<DropdownMenuItem asChild><a href={`/api/warehouse-audits/${encodeURIComponent(String(current.id))}/export`}><FileDown className="size-4" /> Export audit</a></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
              </div>
            </div>
            {isEbayOneTimeAudit && auditStatus === "completed" && <div className="rounded-md border border-blue-500/30 bg-blue-500/10 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">Warehouse shadows ready</p><p className="mt-1 text-xs text-muted-foreground">{numberLabel(marketplaceShadows.length)} reusable shadow SKU{marketplaceShadows.length === 1 ? "" : "s"} tied to {String(current.warehouseName)}. Launching reuses their saved channel data.</p></div>{Number(current.lastEbayShadowLaunchJobNumber || 0) > 0 && <Badge variant="outline">Job #{numberLabel(Number(current.lastEbayShadowLaunchJobNumber))}</Badge>}</div>{marketplaceShadows.length > 0 && <div className="mt-2 flex max-h-24 flex-wrap gap-1 overflow-y-auto">{marketplaceShadows.map((shadow) => <Badge key={String(shadow.shadowId || shadow.shadowSku)} variant="secondary" className="font-mono">{String(shadow.shadowSku || "Shadow")}</Badge>)}</div>}</div>}
            <Dialog open={Boolean(shareAuditUrl)} onOpenChange={(open) => { if (!open) setShareAuditUrl(""); }}>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader><DialogTitle>Share audit link</DialogTitle><DialogDescription>Copy this link and send it to a teammate. They must sign in and have access to this audit.</DialogDescription></DialogHeader>
                <Input aria-label="Audit link" readOnly value={shareAuditUrl} onFocus={(event) => event.target.select()} />
                <DialogFooter><Button variant="outline" onClick={() => setShareAuditUrl("")}>Close</Button><Button onClick={async () => { try { await navigator.clipboard.writeText(shareAuditUrl); toast.success("Audit link copied."); } catch { toast.error("Select the link and copy it manually."); } }}><Copy className="size-4" /> Copy link</Button></DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={Boolean(clearBinTarget)} onOpenChange={(open) => { if (!open && !clearBinBusy) { setClearBinTarget(""); setClearBinPin(""); } }}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle>Clear selected bin</DialogTitle><DialogDescription>Clear {clearBinTarget} from the scanner. Existing counts and stock stay unchanged. A reason and administrator PIN are required.</DialogDescription></DialogHeader>
                <Field label="Reason"><Textarea aria-label="Reason for clearing bin" value={clearBinReason} disabled={clearBinBusy} maxLength={1000} onChange={(event) => setClearBinReason(event.target.value)} placeholder="Why should this bin selection be cleared?" /></Field>
                <Field label="Administrator PIN"><Input aria-label="Administrator PIN" type="password" inputMode="numeric" autoComplete="off" value={clearBinPin} disabled={clearBinBusy} onChange={(event) => setClearBinPin(event.target.value)} /></Field>
                <DialogFooter><Button variant="outline" disabled={clearBinBusy} onClick={() => { setClearBinTarget(""); setClearBinPin(""); }}>Cancel</Button><Button disabled={clearBinBusy || !clearBinReason.trim() || !clearBinPin.trim()} onClick={() => void approveClearBin()}>{clearBinBusy ? <Loader2 className="size-4 animate-spin" /> : <LockKeyhole className="size-4" />} Approve clear bin</Button></DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={purposeEditorOpen} onOpenChange={setPurposeEditorOpen}>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Edit audit purpose</DialogTitle>
                  <DialogDescription>Set the reason for this audit without interrupting or restarting the count.</DialogDescription>
                </DialogHeader>
                <Field label="Audit purpose">
                  <Select value={purposeDraft} onValueChange={setPurposeDraft}>
                    <SelectTrigger><SelectValue placeholder="Select a purpose" /></SelectTrigger>
                    <SelectContent>{warehouseAuditReasonOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                </Field>
                {isReceivingAuditReason(purposeDraft) && <Field label="Supplier">{receivingSupplierPicker(purposeDraft === "external_po_receipt")}</Field>}
                {purposeDraft === "external_po_receipt" && <Field label="External PO number"><Input value={externalPurchaseOrderNumber} onChange={(event) => setExternalPurchaseOrderNumber(event.target.value)} placeholder="PO number from the other system" /></Field>}
                <DialogFooter><Button variant="outline" onClick={() => setPurposeEditorOpen(false)}>Cancel</Button><Button disabled={purposeSaving || !purposeDraft || (isReceivingAuditReason(purposeDraft) && !receivingSupplierId) || (purposeDraft === "external_po_receipt" && !externalPurchaseOrderNumber.trim())} onClick={() => void saveAuditPurpose()}>{purposeSaving && <Loader2 className="size-4 animate-spin" />} Save purpose</Button></DialogFooter>
              </DialogContent>
            </Dialog>

            {isReceivingAuditReason(current.reason) && (() => {
              const documents = Array.isArray(current.receivingDocuments) ? current.receivingDocuments as Array<Record<string, unknown>> : [];
              const review = receivingReview;
              const reviewLines = receivingReviewLines;
              return <Card className="border-blue-500/30"><CardHeader className="pb-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-sm">Packing slip and receiving documents</CardTitle><CardDescription>Take packing-slip photos or upload files. DataPlus saves the originals, runs local OCR automatically, and compares the extracted quantities with the shipment scans.</CardDescription></div><div className="flex flex-wrap gap-2"><Badge variant="outline">{String(current.supplierName || "Supplier not set")}</Badge>{String(current.externalPurchaseOrderNumber || "") && <Badge variant="outline">External PO {String(current.externalPurchaseOrderNumber)}</Badge>}{String(current.linkedPurchaseOrderNumber || "") && <Badge variant="outline">DataPlus PO {String(current.linkedPurchaseOrderNumber)}</Badge>}</div></div></CardHeader><CardContent className="grid gap-4"><div className="flex flex-wrap items-end gap-2"><Field label="Document type"><Select value={receivingDocumentType} onValueChange={(value) => setReceivingDocumentType(value as "packing_slip" | "purchase_order")}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="packing_slip">Packing slip</SelectItem><SelectItem value="purchase_order">Purchase order</SelectItem></SelectContent></Select></Field><label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted"><FileUp className="size-4" /> Upload files<input className="sr-only" type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif" disabled={receivingDocumentBusy} onChange={(event) => { void uploadReceivingDocuments(event.target.files); event.currentTarget.value = "" }} /></label><label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted"><Camera className="size-4" /> Take photo<input className="sr-only" type="file" accept="image/*" capture="environment" disabled={receivingDocumentBusy} onChange={(event) => { void uploadReceivingDocuments(event.target.files); event.currentTarget.value = "" }} /></label><Button disabled={receivingDocumentBusy || !current.supplierName || !documents.some((document) => /^image\/(?:jpe?g|png|webp)$/i.test(String(document.mimeType || "")))} onClick={() => void analyzeReceivingDocuments("ocr")}>{receivingDocumentBusy ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />} Re-run local OCR</Button><Button variant="outline" disabled={receivingDocumentBusy || !documents.some((document) => /^image\/(?:jpe?g|png|webp)$/i.test(String(document.mimeType || "")))} onClick={() => void analyzeReceivingDocuments("ai")}><Sparkles className="size-4" /> Use David fallback</Button></div>{!hasPackingSlip && <Alert className="border-amber-500/40 bg-amber-500/10"><AlertTriangle className="size-4" /><AlertTitle>Packing slip required</AlertTitle><AlertDescription>Add at least one packing slip before the receipt can be posted.</AlertDescription></Alert>}{documents.length > 0 && <div className="flex flex-wrap gap-2">{documents.map((document) => <Button key={String(document.id)} size="sm" variant="outline" onClick={() => setReceivingDocumentPreview(document)}><Eye className="size-3.5" /> {String(document.name || "Document")}</Button>)}</div>}{review && <div className="grid gap-3"><div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant={String(review.provider) === "local-ocr" ? "success" : "secondary"}>{String(review.provider) === "local-ocr" ? "Local OCR" : "David fallback"}</Badge><Badge variant="outline">{String(review.templateKey || "generic-packing-slip-v1")}</Badge><span>{numberLabel(Number((review.documentsAnalyzed as unknown[] || []).length))} of {numberLabel(Number(review.documentCount || documents.length))} documents analyzed</span>{Number(review.averageConfidence || 0) > 0 && <span>{numberLabel(Number(review.averageConfidence || 0))}% confidence</span>}<span>{dateLabel(String(review.analyzedAt || ""))}</span></div>{Array.isArray(review.warnings) && review.warnings.length > 0 && <Alert className="border-amber-500/40 bg-amber-500/10"><AlertTriangle className="size-4" /><AlertTitle>Review extraction warnings</AlertTitle><AlertDescription>{(review.warnings as string[]).join(" ")}</AlertDescription></Alert>}<div className="max-h-80 overflow-auto rounded-md border"><Table><TableHeader className="sticky top-0 z-10 bg-background"><TableRow><TableHead>Vendor item</TableHead><TableHead>UPC / Mfr SKU</TableHead><TableHead>Description</TableHead><TableHead className="text-right">Slip qty</TableHead><TableHead className="text-right">Scanned</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{reviewLines.map((line) => <TableRow key={String(line.id)}><TableCell className="font-medium">{String(line.vendorItemNumber || "-")}</TableCell><TableCell><p>{String(line.upc || "-")}</p><p className="text-xs text-muted-foreground">{String(line.manufacturerSku || "-")}</p></TableCell><TableCell className="max-w-56 truncate">{String(line.description || "-")}</TableCell><TableCell className="text-right">{numberLabel(Number(line.expectedQty || 0))}</TableCell><TableCell className="text-right">{numberLabel(Number(line.countedQty || 0))}</TableCell><TableCell><Badge variant={line.status === "matched" ? "default" : line.status === "variance" ? "destructive" : "outline"}>{line.status === "matched" ? "Matched" : line.status === "variance" ? `Variance ${Number(line.variance || 0) > 0 ? "+" : ""}${numberLabel(Number(line.variance || 0))}` : "Not scanned"}</Badge></TableCell></TableRow>)}{!reviewLines.length && <TableRow><TableCell colSpan={6} className="h-20 text-center text-muted-foreground">No readable line items were extracted. Review this supplier's column mapping or use David fallback.</TableCell></TableRow>}</TableBody></Table></div><p className="text-xs text-muted-foreground">The packing slip is evidence, not inventory. Review any slip-only, scan-only, over, or short lines before posting the receipt.</p></div>}</CardContent></Card>;
            })()}

            <Dialog open={Boolean(receivingDocumentPreview)} onOpenChange={(open) => !open && setReceivingDocumentPreview(null)}>
              <DialogContent className="flex h-[100dvh] max-h-[100dvh] flex-col gap-0 overflow-hidden p-0 sm:h-[92dvh] sm:max-w-6xl sm:rounded-lg">
                <DialogHeader className="shrink-0 border-b p-4 pr-12">
                  <DialogTitle>{String(receivingDocumentPreview?.name || "Receiving document")}</DialogTitle>
                  <DialogDescription>Review the original document beside the latest extraction. Previewing never changes inventory or uses David.</DialogDescription>
                </DialogHeader>
                <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
                  <div className="min-h-[42dvh] overflow-hidden border-b bg-muted/40 p-2 lg:min-h-0 lg:border-r lg:border-b-0 sm:p-4">
                    {/^(?:image)\/(?:jpe?g|png|webp)$/i.test(String(receivingDocumentPreview?.mimeType || "")) ? <img src={String(receivingDocumentPreview?.url || "")} alt={String(receivingDocumentPreview?.name || "Receiving document")} className="size-full rounded-md border bg-white object-contain" /> : String(receivingDocumentPreview?.mimeType || "") === "application/pdf" ? <iframe src={String(receivingDocumentPreview?.url || "")} title={String(receivingDocumentPreview?.name || "Receiving document")} className="size-full min-h-[420px] rounded-md border bg-white" /> : <div className="grid size-full min-h-64 place-items-center rounded-md border border-dashed bg-background p-6 text-center text-sm text-muted-foreground">Preview is unavailable for this file type. Open the original document instead.</div>}
                  </div>
                  <ScrollArea className="min-h-0">
                    <div className="grid gap-4 p-4">
                      {(() => {
                        const previewReview = current.packingSlipReview as Record<string, unknown> | null;
                        const previewLines = Array.isArray(previewReview?.lines) ? previewReview.lines as Array<Record<string, unknown>> : [];
                        if (!previewReview) return <div className="rounded-md border border-dashed p-5 text-sm"><p className="font-medium">Ready for extraction</p><p className="mt-1 text-muted-foreground">Confirm the supplier and document are correct, then run local OCR. The original remains available for comparison.</p></div>;
                        return <><div className="grid grid-cols-2 gap-2"><div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Source</p><p className="mt-1 font-medium">{String(previewReview.provider) === "local-ocr" ? "Local OCR" : "David fallback"}</p></div><div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Confidence</p><p className="mt-1 font-medium">{Number(previewReview.averageConfidence || 0) > 0 ? `${numberLabel(Number(previewReview.averageConfidence || 0))}%` : "Not reported"}</p></div><div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Extracted rows</p><p className="mt-1 font-medium">{numberLabel(previewLines.length)}</p></div><div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Documents analyzed</p><p className="mt-1 font-medium">{numberLabel(Number((previewReview.documentsAnalyzed as unknown[] || []).length))} / {numberLabel(Number(previewReview.documentCount || 0))}</p></div></div>{Array.isArray(previewReview.warnings) && previewReview.warnings.length > 0 && <Alert className="border-amber-500/40 bg-amber-500/10"><AlertTriangle className="size-4" /><AlertTitle>Review needed</AlertTitle><AlertDescription>{(previewReview.warnings as string[]).join(" ")}</AlertDescription></Alert>}<div className="overflow-hidden rounded-md border"><Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead className="text-right">Slip</TableHead><TableHead className="text-right">Count</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{previewLines.slice(0, 50).map((line) => <TableRow key={String(line.id)}><TableCell><p className="font-medium">{String(line.vendorItemNumber || line.upc || "-")}</p><p className="max-w-48 truncate text-xs text-muted-foreground">{String(line.description || line.manufacturerSku || "")}</p></TableCell><TableCell className="text-right">{numberLabel(Number(line.expectedQty || 0))}</TableCell><TableCell className="text-right">{numberLabel(Number(line.countedQty || 0))}</TableCell><TableCell><Badge variant={line.status === "matched" ? "default" : line.status === "variance" ? "destructive" : "outline"}>{line.status === "matched" ? "Matched" : line.status === "variance" ? "Variance" : "Not scanned"}</Badge></TableCell></TableRow>)}{!previewLines.length && <TableRow><TableCell colSpan={4} className="h-20 text-center text-muted-foreground">No readable rows were extracted.</TableCell></TableRow>}</TableBody></Table></div>{previewLines.length > 50 && <p className="text-xs text-muted-foreground">Showing the first 50 of {numberLabel(previewLines.length)} extracted rows.</p>}</>;
                      })()}
                    </div>
                  </ScrollArea>
                </div>
                <DialogFooter className="shrink-0 border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                  <Button variant="outline" asChild><a href={String(receivingDocumentPreview?.url || "#")} target="_blank" rel="noreferrer"><FileText className="size-4" /> Open original</a></Button>
                  <Button variant="outline" onClick={() => setReceivingDocumentPreview(null)}>Close</Button>
                  <Button disabled={receivingDocumentBusy || !current.supplierName || !/^(?:image)\/(?:jpe?g|png|webp)$/i.test(String(receivingDocumentPreview?.mimeType || ""))} onClick={() => void analyzeReceivingDocuments("ocr")}>{receivingDocumentBusy ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />} Extract with local OCR</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            {auditStatus === "pending_review" && <div className="grid gap-2 rounded-md border border-blue-200 bg-blue-50/60 p-3 text-sm dark:border-blue-500/30 dark:bg-blue-500/10"><p className="font-medium">{isReceivingAudit ? "Shipment scan complete. Receipt review required." : "Count complete. Inventory action required."}</p><p className="text-muted-foreground">{isLinkedPurchaseOrderReceipt ? `Review the scanned quantities against ${String(current.linkedPurchaseOrderNumber || "the purchase order")} and its packing slip, then post the receipt.` : isReceivingAudit ? "Review the shipment against its packing slip, then stock it here or use the received units for eligible open orders." : "Choose whether these units should serve open customer orders, remain in this warehouse, transfer elsewhere, or be returned to their suppliers."}</p>{Boolean(current.reviewNote) && <p className="text-muted-foreground">Counter note: {String(current.reviewNote)}</p>}</div>}
            {auditDisposition && <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-sm"><p className="font-medium">Inventory outcome: {String(auditDisposition.label || "Applied")}</p>{Boolean(auditDisposition.destinationWarehouseName) && <p className="text-muted-foreground">Destination: {String(auditDisposition.destinationWarehouseName)}</p>}{Number(auditDisposition.allocatedQty || 0) > 0 && <p className="text-muted-foreground">Allocated: {numberLabel(Number(auditDisposition.allocatedQty || 0))} units across {numberLabel(dispositionOrders.filter((row) => Number(row.allocatedQty || 0) > 0).length)} open orders.</p>}{Number(auditDisposition.blockedQty || 0) > 0 && <p className="text-amber-700 dark:text-amber-300">{numberLabel(Number(auditDisposition.blockedQty || 0))} units remain tied to submitted supplier POs and require buyer follow-up.</p>}{dispositionOrders.length > 0 && <div className="flex flex-wrap gap-2">{dispositionOrders.filter((row) => Number(row.allocatedQty || 0) > 0).map((row) => <Button key={String(row.id)} size="sm" variant="outline" asChild><a href={`/orders/${encodeURIComponent(String(row.id))}`}>#{String(row.orderNumber || row.id)} · {numberLabel(Number(row.allocatedQty || 0))}</a></Button>)}</div>}{dispositionReturns.length > 0 && <div className="grid gap-1"><p className="text-muted-foreground">Supplier return drafts:</p><div className="flex flex-wrap gap-2">{dispositionReturns.map((row) => <Badge key={String(row.id || row.returnNumber)} variant="outline">{String(row.returnNumber || "Return draft")} · {String(row.supplierName || "Supplier")} · {numberLabel(Number(row.totalUnits || 0))}</Badge>)}</div></div>}{Boolean(auditDisposition.note) && <p className="text-muted-foreground">Note: {String(auditDisposition.note)}</p>}</div>}
            <Dialog open={dispositionOpen} onOpenChange={setDispositionOpen}>
              <DialogContent className="max-w-3xl">
                <DialogHeader>
                  <DialogTitle>{isReceivingAudit ? "Finish inbound receipt" : "Finish count"}</DialogTitle>
                  <DialogDescription>{isLinkedPurchaseOrderReceipt ? `Post the scanned quantities to ${String(current.linkedPurchaseOrderNumber || "the linked purchase order")} and add the packing-slip evidence to its receipt history.` : isReceivingAudit ? "Post the scanned shipment as new inbound inventory. The receiving audit and original packing slips remain attached as evidence." : "The audit is the review record. DataPlus checks supplier-equivalent SKUs against open orders before inventory can be returned."}</DialogDescription>
                </DialogHeader>
                {isLinkedPurchaseOrderReceipt && <div className="grid gap-3 rounded-md border bg-muted/30 p-4 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Purchase order</p><p className="font-medium">{String(current.linkedPurchaseOrderNumber || "-")}</p></div><div><p className="text-xs text-muted-foreground">Scanned units</p><p className="font-medium">{numberLabel(lines.reduce((sum, line) => sum + Number(line.countedQty || 0), 0))}</p></div><div><p className="text-xs text-muted-foreground">Packing slips</p><p className="font-medium">{numberLabel(receivingDocuments.filter((document) => String(document.documentType || "") === "packing_slip").length)}</p></div></div>}
                {!isLinkedPurchaseOrderReceipt && <>
                {actionPreviewLoading && <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Checking open orders across supplier-equivalent SKUs...</div>}
                {actionPreviewError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{actionPreviewError}</div>}
                {!isEbayOneTimeAudit && !actionPreviewLoading && !actionPreviewError && actionPreview && <div className={`rounded-md border p-4 ${compatibleDemandQty > 0 ? "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-100" : "bg-muted/30"}`}><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-medium">{compatibleDemandQty > 0 ? `${numberLabel(compatibleDemandQty)} counted units can serve open orders` : "No compatible open order demand found"}</p><p className="mt-1 text-xs text-muted-foreground">Matched across UPC, manufacturer part number, vendor SKU, and equivalent supplier SKUs.</p></div>{compatibleOrderCount > 0 && <Badge className="bg-emerald-600 text-white">{numberLabel(compatibleOrderCount)} order{compatibleOrderCount === 1 ? "" : "s"}</Badge>}</div>{compatibleOrders.length > 0 && <ScrollArea className="mt-3 max-h-40"><div className="grid gap-2 pr-3">{compatibleOrders.slice(0, 12).map((order) => <a key={String(order.id)} href={`/orders/${encodeURIComponent(String(order.id))}`} className="flex items-center justify-between gap-3 rounded-md border border-emerald-300/70 bg-background/80 px-3 py-2 text-sm hover:bg-background"><span className="min-w-0"><span className="block font-medium">#{String(order.orderNumber || order.id)}</span><span className="block truncate text-xs text-muted-foreground">{String(order.orderSku || order.auditSku || "Matched item")}</span></span><span className="flex shrink-0 items-center gap-2"><Badge variant="outline">{String(order.matchedBy || "") === "supplier_family" ? "Supplier-equivalent" : "Catalog SKU"}</Badge><span className="text-muted-foreground">{numberLabel(Number(order.remainingQty || 0))} needed</span></span></a>)}</div></ScrollArea>}</div>}
                {isEbayOneTimeAudit && <Alert className="border-blue-500/30 bg-blue-500/10"><Store className="size-4" /><AlertTitle>Reusable warehouse shadows</AlertTitle><AlertDescription>DataPlus will stock these counts here and create or reuse one cross-channel shadow per product using this warehouse code. Supplier inventory will not replenish these shadows.</AlertDescription></Alert>}
                <div className="grid gap-3 md:grid-cols-2">
                  {[
                    { value: "fulfill_orders", title: "Use for open orders", description: "Stock the count here, then allocate compatible units and reroute affected orders." },
                    { value: "stock_here", title: "Stock here", description: `Make the approved units available in ${String(current.warehouseName)}.` },
                    { value: "transfer", title: "Transfer", description: "Count the units here, then move them to another physical warehouse." },
                    { value: "return_to_supplier", title: "Return to supplier", description: "Hold the units from sale and create a supplier-return draft." },
                  ].filter((option) => isEbayOneTimeAudit ? option.value === "stock_here" : !isReceivingAudit || ["fulfill_orders", "stock_here"].includes(option.value)).map((option) => <button key={option.value} type="button" onClick={() => setDispositionType(option.value as typeof dispositionType)} className={`rounded-md border p-4 text-left transition-colors ${dispositionType === option.value ? "border-primary bg-primary/10 ring-1 ring-primary" : "bg-background hover:bg-muted/60"}`}><span className="font-medium">{isEbayOneTimeAudit ? "Stock here and create shadows" : option.title}</span><span className="mt-1 block text-xs text-muted-foreground">{isEbayOneTimeAudit ? `Keep inventory in ${String(current.warehouseName)} and prepare reusable temporary-listing SKUs.` : option.description}</span></button>)}
                </div>
                {dispositionType === "transfer" && <Field label="Destination warehouse"><Select value={destinationWarehouseId} onValueChange={setDestinationWarehouseId}><SelectTrigger><SelectValue placeholder="Choose a physical warehouse" /></SelectTrigger><SelectContent>{transferDestinations.map((item) => <SelectItem key={String(item.id || item.name)} value={String(item.id || "")}>{String(item.name || "Warehouse")}{item.code ? ` (${String(item.code)})` : ""}</SelectItem>)}</SelectContent></Select></Field>}
                {dispositionType === "return_to_supplier" && <div className={`rounded-md border p-3 text-sm ${missingReturnSupplierLines.length || compatibleDemandQty > 0 ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" : "bg-muted/30"}`}><p className="font-medium">Returns are created separately for each verified supplier</p><p className="mt-1 text-xs text-muted-foreground">A mixed audit can create multiple supplier-return drafts. Confirm every multi-supplier line first so one item is not returned to multiple vendors.</p>{multipleSupplierActionLines > 0 && <p className="mt-2">{numberLabel(multipleSupplierActionLines)} counted line{multipleSupplierActionLines === 1 ? " has" : "s have"} multiple supplier coverage.</p>}{missingReturnSupplierLines.length > 0 && <p className="mt-2 font-medium">{numberLabel(missingReturnSupplierLines.length)} line{missingReturnSupplierLines.length === 1 ? "" : "s"} still need a supplier.</p>}{compatibleDemandQty > 0 && <label className="mt-3 flex items-start gap-2 rounded-md border border-amber-400/60 bg-background/70 p-3"><Checkbox checked={returnDespiteDemand} onCheckedChange={(checked) => setReturnDespiteDemand(checked === true)} /><span><span className="block font-medium">Return despite open customer demand</span><span className="mt-0.5 block text-xs text-muted-foreground">I reviewed {numberLabel(compatibleOrderCount)} compatible order{compatibleOrderCount === 1 ? "" : "s"} and still want supplier-return drafts created.</span></span></label>}</div>}
                <Field label="Outcome note"><Textarea value={dispositionNote} onChange={(event) => setDispositionNote(event.target.value)} placeholder="Optional handling instructions, return reason, or transfer note" /></Field>
                </>}
                {isLinkedPurchaseOrderReceipt && <Field label="Receipt note"><Textarea value={dispositionNote} onChange={(event) => setDispositionNote(event.target.value)} placeholder="Optional receiving note" /></Field>}
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDispositionOpen(false)}>Cancel</Button>
                  <Button disabled={finishActionBlocked} onClick={() => void complete()}>{busy && <Loader2 className="size-4 animate-spin" />}{isLinkedPurchaseOrderReceipt ? "Post PO receipt" : isEbayOneTimeAudit ? "Apply & create shadows" : dispositionType === "fulfill_orders" ? "Receive & use for open orders" : dispositionType === "transfer" ? "Apply & transfer" : dispositionType === "return_to_supplier" ? "Create supplier return draft(s)" : isReceivingAudit ? "Receive & stock" : "Apply & stock"}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            {auditStatus === "in_progress" && Boolean(current.returnNote) && <div className="rounded-md border border-amber-200 bg-amber-50/50 p-3 text-sm"><p className="font-medium">Returned for recount</p><p className="mt-1 text-muted-foreground">Recount note: {String(current.returnNote)}</p></div>}
            <Dialog open={cameraOpen} onOpenChange={(open) => { if (!open) closeCameraScanner(); }}>
              <DialogContent className="!inset-0 !flex !h-[100dvh] !max-w-none !translate-x-0 !translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:!left-1/2 sm:!top-1/2 sm:!h-[min(90dvh,760px)] sm:!max-w-3xl sm:!-translate-x-1/2 sm:!-translate-y-1/2 sm:rounded-lg" showCloseButton={false}>
                <DialogHeader className="shrink-0 border-b px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><DialogTitle>{cameraMode === "bin" ? "Scan warehouse bin" : "Scan warehouse products"}</DialogTitle><DialogDescription className="break-words">Each barcode is checked immediately against the catalog and added to this audit after confirmation.</DialogDescription></div>
                    <div className="flex shrink-0 items-center gap-2">{torchAvailable && <Button size="icon" variant={torchEnabled ? "default" : "outline"} title={torchEnabled ? "Turn off camera light" : "Turn on camera light"} onClick={() => void toggleAuditTorch()}><Flashlight className="size-4" /></Button>}{cameraDevices.length > 1 && <Select value={selectedCameraId} onValueChange={(value) => { setSelectedCameraId(value); setCameraAttempt((attempt) => attempt + 1); }}><SelectTrigger className="h-9 w-36"><SelectValue placeholder="Back camera" /></SelectTrigger><SelectContent>{cameraDevices.map((device) => <SelectItem key={device.id} value={device.id}>{/back|rear|environment|world/i.test(device.label) ? `Back: ${device.label}` : device.label}</SelectItem>)}</SelectContent></Select>}</div>
                  </div>
                  <div className="mt-2 grid min-w-0 gap-1.5">
                    <Label>Current bin</Label>
                    {activeAuditBins.length ? <Select value={activeBin || "__unassigned"} disabled={busy} onValueChange={(value) => { setActiveBin(value); setCameraMessage(`Counting in bin ${value}. Scan the next product.`); }}><SelectTrigger aria-label="Camera bin" className="w-full min-w-0"><SelectValue placeholder="Select bin" /></SelectTrigger><SelectContent><SelectItem value="__unassigned" disabled>No bin selected</SelectItem>{activeBin && !activeAuditBins.some((bin) => String(bin.code) === activeBin) && <SelectItem value={activeBin} disabled>{activeBin} (current)</SelectItem>}{activeAuditBins.map((bin) => <SelectItem key={String(bin.id || bin.code)} value={String(bin.code)}>{String(bin.code)}{bin.name ? ` - ${String(bin.name)}` : ""}</SelectItem>)}</SelectContent></Select> : <Input aria-label="Camera bin" value={activeBin} disabled={busy} onChange={(event) => { if (event.target.value.trim()) setActiveBin(event.target.value); }} placeholder="Enter bin" />}
                  </div>
                </DialogHeader>
                <div className="relative min-h-0 flex-1 bg-black">
                  <video ref={videoRef} className="size-full object-contain" autoPlay muted playsInline />
                  {cameraStreamState !== "ready" && !lastScan && <div className="absolute inset-0 grid place-items-center bg-black/85 p-5 text-center text-white"><div className="max-w-xs"><p className="font-medium">{cameraStreamState === "opening" ? "Starting camera..." : cameraStreamState === "permission" ? "Camera permission is needed" : "Camera could not start"}</p><p className="mt-2 text-sm text-white/75">{cameraStreamState === "permission" ? "Allow Camera for dataplusapp.duckdns.org in Safari. Safari remembers this choice until it is changed in website settings." : "Make sure no other app is using the camera, then try again."}</p>{cameraStreamState !== "opening" && <Button className="mt-4" variant="secondary" onClick={() => { setCameraStreamState("opening"); setCameraAttempt((attempt) => attempt + 1); }}>Try camera again</Button>}</div></div>}
                  {cameraStreamState === "ready" && <div className="pointer-events-none absolute inset-x-[7%] top-1/2 -translate-y-1/2" aria-hidden="true"><div className="h-28 rounded-md border-2 border-emerald-400/90 shadow-[0_0_18px_rgba(74,222,128,.55)]"><div className="mt-14 h-0.5 bg-emerald-400" /></div><p className="mx-auto mt-3 w-fit rounded-full bg-black/75 px-3 py-1.5 text-xs font-medium text-white">{cameraMode === "bin" ? "Align one bin label inside the frame" : `Align one barcode inside the frame · ${scannerEngine === "native" ? "Fast scan" : "Compatible scan"}`}</p></div>}
                  {!lastScan && cameraLookupBusy && <div className="absolute inset-0 grid place-items-center bg-black/40"><div className="flex max-w-[90%] items-center gap-2 rounded-md bg-background px-4 py-3 text-foreground shadow-xl" role="status" aria-live="assertive"><Loader2 className="size-5 shrink-0 animate-spin" /><span className="truncate">{cameraMode === "bin" ? "Checking bin" : "Searching for product"}{barcode ? ` ${barcode}` : ""}...</span></div></div>}
                  {lastScan && <div data-testid="camera-notifications" className={`absolute inset-x-3 top-3 max-h-[46%] overflow-y-auto rounded-md border p-3 text-white shadow-xl ${lastScan.matched ? "border-emerald-300 bg-emerald-700" : "border-amber-300 bg-amber-700"}`} aria-live="polite"><div className="flex items-start gap-3">{lastScan.matched ? <CheckCircle2 className="mt-0.5 size-5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-5 shrink-0" />}<div className="min-w-0 flex-1"><p className="font-semibold">{lastScan.matched ? "Catalog item matched" : "Product not found"}</p><p className="mt-1 break-all font-mono text-xs text-white/80">{lastScan.sku || lastScan.barcode}</p>{lastScan.title && <p className="mt-1 truncate text-sm">{lastScan.title}</p>}{lastScan.matched && <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium"><span className="rounded bg-black/20 px-2 py-1">UOM {lastScan.uomName || "Each"} ({lastScan.uom || "EA"})</span><span className="rounded bg-black/20 px-2 py-1">Case pack {Math.max(1, Number(lastScan.casePack || 1))}</span></div>}<p className="mt-1 text-sm">{busy || quickCreateBusy ? "Saving..." : cameraMessage}</p><div className="mt-3 flex items-center gap-3"><Label htmlFor="camera-scan-quantity" className="shrink-0 text-sm font-medium text-white">Counted quantity</Label><Input id="camera-scan-quantity" className="h-10 max-w-32 bg-background text-base text-foreground" type="number" min="1" max="100000" inputMode="numeric" autoFocus value={cameraScanQuantity} onChange={(event) => setCameraScanQuantity(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && lastScan.matched) { event.preventDefault(); void confirmCameraScan(); } }} /></div>{!lastScan.matched ? <p className="mt-2 text-xs text-white/80">Skip it, open Quick create to take product photos, or use the full workflow.</p> : null}</div></div></div>}
                </div>
                <DialogFooter className="warehouse-audit-camera-footer !m-0 shrink-0 !flex-col gap-2 rounded-none border-t bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:!flex-row sm:items-center sm:justify-between">
                  <p className="w-full text-xs text-muted-foreground sm:min-w-0 sm:flex-1 sm:truncate">{cameraMessage || "Camera stays open between products for faster scanning."}</p>
                  <div className="grid w-full shrink-0 grid-cols-3 gap-2 sm:w-auto">
                    {lastScan && !lastScan.matched ? <><Button variant="outline" onClick={() => resetCameraScan("Skipped. Ready for the next barcode.")}>Skip</Button><Button variant="outline" disabled={cameraLookupBusy || busy} onClick={() => void continueToFullCreate()}>{cameraLookupBusy || busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Full create</Button><Button disabled={cameraLookupBusy || busy} onClick={() => beginQuickCreate()}><Camera className="size-4" /> Quick create</Button></> : lastScan ? <><Button variant="outline" onClick={closeCameraScanner}>Done</Button><Button variant="outline" disabled={cameraLookupBusy} onClick={() => resetCameraScan()}>Cancel scan</Button><Button disabled={cameraLookupBusy || busy} onClick={() => void confirmCameraScan()}>{cameraLookupBusy || busy ? <Loader2 className="size-4 animate-spin" /> : null} Add count</Button></> : <Button className="col-span-3 w-full" variant="outline" onClick={closeCameraScanner}>Done</Button>}
                  </div>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <input
              ref={quickCreatePhotoInputRef}
              className="sr-only"
              type="file"
              accept="image/*"
              capture="environment"
              tabIndex={-1}
              onChange={(event) => {
                void readManualPhotos(event.currentTarget.files);
                event.currentTarget.value = "";
              }}
            />
            <Dialog open={quickCreatePhotoOpen} onOpenChange={(open) => { if (!open && !quickCreateBusy) closeQuickCreatePhotoCapture(); }}>
              <DialogContent className="!inset-0 !flex !h-[100dvh] !max-w-none !translate-x-0 !translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 sm:!left-1/2 sm:!top-1/2 sm:!h-[min(88dvh,720px)] sm:!max-w-xl sm:!-translate-x-1/2 sm:!-translate-y-1/2 sm:rounded-lg" showCloseButton={false}>
                <DialogHeader className="shrink-0 border-b px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <DialogTitle>Quick create product</DialogTitle>
                      <DialogDescription>Photograph the product, then create the draft SKU and continue scanning.</DialogDescription>
                    </div>
                    <Badge className="shrink-0" variant="outline">{manualPhotoUrls.length}/8 photos</Badge>
                  </div>
                  <div className="mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>UPC <span className="font-mono font-medium text-foreground">{String(manualUnknown?.barcode || "-")}</span></span>
                    <span>Qty <span className="font-medium text-foreground">{String(manualUnknown?.qty || "1")}</span></span>
                    <span>Bin <span className="font-medium text-foreground">{String(manualUnknown?.locationBin || activeBin || "Unassigned")}</span></span>
                  </div>
                </DialogHeader>
                <div className="min-h-0 flex-1 overflow-y-auto bg-muted/20 p-4">
                  <div className="mb-4 grid grid-cols-2 gap-3 rounded-md border bg-background p-3">
                    <Field label="Unit of measure">
                      <Select
                        value={String(manualUnknown?.uom || "EA")}
                        disabled={quickCreateBusy}
                        onValueChange={(value) => setManualUnknown((entry) => entry ? { ...entry, uom: value } : entry)}
                      >
                        <SelectTrigger aria-label="Quick create unit of measure"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {warehouseUomOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label} ({option.value})</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Case pack">
                      <Input
                        aria-label="Quick create case pack"
                        type="number"
                        min="1"
                        max="100000"
                        inputMode="numeric"
                        disabled={quickCreateBusy}
                        value={String(manualUnknown?.casePack || "1")}
                        onChange={(event) => setManualUnknown((entry) => entry ? { ...entry, casePack: event.target.value } : entry)}
                      />
                    </Field>
                  </div>
                  {manualPhotoUrls.length ? (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {manualPhotoUrls.map((photo, index) => (
                        <div key={`${photo.slice(-24)}-${index}`} className="group relative aspect-square overflow-hidden rounded-md border bg-background">
                          <img src={photo} alt={`Product photo ${index + 1}`} className="size-full object-cover" />
                          <Badge className="absolute bottom-2 left-2 bg-black/75 text-white" variant="secondary">Photo {index + 1}</Badge>
                          <Button
                            type="button"
                            size="icon"
                            variant="secondary"
                            className="absolute right-2 top-2 size-8 bg-background/90"
                            aria-label={`Remove product photo ${index + 1}`}
                            onClick={() => removeManualPhoto(index)}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="grid min-h-72 w-full place-items-center rounded-md border border-dashed bg-background p-6 text-center hover:bg-muted/50"
                      onClick={() => quickCreatePhotoInputRef.current?.click()}
                    >
                      <span>
                        <Camera className="mx-auto size-10 text-primary" />
                        <span className="mt-3 block font-medium">Take the first product photo</span>
                        <span className="mt-1 block text-sm text-muted-foreground">Use the back camera. You can add up to eight photos.</span>
                      </span>
                    </button>
                  )}
                </div>
                <DialogFooter className="!m-0 shrink-0 !flex-col gap-2 rounded-none border-t bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:!flex-row sm:items-center sm:justify-between">
                  <Button className="w-full sm:w-auto" variant="outline" disabled={quickCreateBusy} onClick={closeQuickCreatePhotoCapture}>Cancel</Button>
                  <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                    <Button className="w-full" variant="outline" disabled={quickCreateBusy || manualPhotoUrls.length >= 8} onClick={() => quickCreatePhotoInputRef.current?.click()}>
                      <Camera className="size-4" /> {manualPhotoUrls.length ? "Take another" : "Take photo"}
                    </Button>
                    <Button className="w-full" disabled={quickCreateBusy || !manualPhotoUrls.length || !(Number(manualUnknown?.casePack || 0) >= 1)} onClick={() => void saveManualQuickCreatedProduct()}>
                      {quickCreateBusy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create draft SKU
                    </Button>
                  </div>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <div className="warehouse-audit-bin flex flex-row flex-wrap items-end gap-2 rounded-md border bg-muted/20 p-3">
              <Field label="Current bin / location">
                {activeAuditBins.length ? (
                  <Select value={activeBin || "__unassigned"} disabled={auditStatus !== "in_progress"} onValueChange={(value) => { if (value === "__unassigned" && activeBin) requestClearBin(); else setActiveBin(value === "__unassigned" ? "" : value); }}>
                    <SelectTrigger className="w-full min-w-0 sm:w-64"><SelectValue placeholder="Select bin" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unassigned" disabled={Boolean(activeBin)}>No bin selected</SelectItem>
                      {activeAuditBins.map((bin) => <SelectItem key={String(bin.id || bin.code)} value={String(bin.code)}>{String(bin.code)}{bin.nickname ? ` - ${String(bin.nickname)}` : bin.name ? ` - ${String(bin.name)}` : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={activeBin} disabled={auditStatus !== "in_progress"} onChange={(event) => { if (!event.target.value.trim() && activeBin) requestClearBin(); else setActiveBin(event.target.value); }} placeholder="Enter location" />
                )}
              </Field>

              <p className="max-w-sm text-xs text-muted-foreground sm:pb-2">{activeAuditBins.length ? "Choose a configured bin before scanning. The selection is saved against each new count line." : "No active bins are configured for this warehouse. Enter a location manually; the selection is saved against each new count line."}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                autoFocus
                disabled={auditStatus !== "in_progress"}
                value={barcode}
                onChange={(event) => setBarcode(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void submit();
                  }
                }}
                placeholder="Scan or enter UPC, then press Enter"
              />
              <Button
                className="w-full sm:w-auto"
                disabled={busy || auditStatus !== "in_progress" || !barcode.trim()}
                onClick={() => void submit()}
              >
                <Plus className="size-4" /> Add scan
              </Button>
            </div>
            {busy && barcode.trim() && auditStatus === "in_progress" && (
              <div className="flex items-center gap-2 rounded-md border border-primary/25 bg-primary/10 px-3 py-2 text-sm font-medium text-primary" role="status" aria-live="polite">
                <Loader2 className="size-4 animate-spin" /> Looking up {barcode.trim()} in the catalog...
              </div>
            )}
            {lastScan && (
              <div
                className={`rounded-md border p-3 text-sm ${lastScan.matched ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-200"}`}
              >
                <span className="font-medium">
                  {lastScan.matched
                    ? "Catalog item found."
                    : "Catalog item not found."}
                </span>{" "}
                {lastScan.message}{" "}
                <span className="ml-1 font-mono text-xs">
                  {lastScan.barcode}
                </span>
                {lastScan.matched && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="outline">UOM {lastScan.uomName || "Each"} ({lastScan.uom || "EA"})</Badge>
                    <Badge variant="outline">Case pack {Math.max(1, Number(lastScan.casePack || 1))}</Badge>
                  </div>
                )}
              </div>
            )}
            {manualUnknown && auditStatus === "in_progress" && (
              <div ref={manualCreateRef} className="warehouse-sku-create grid scroll-mt-20 gap-3 rounded-md border bg-card p-3 text-card-foreground [&_input:not(:disabled)]:bg-background [&_input:not(:disabled)]:text-foreground [&_input:not(:disabled)]:border-foreground/25 [&_[data-slot=select-trigger]]:bg-background [&_[data-slot=select-trigger]]:border-foreground/25">
                <div>
                  <p className="font-medium">Resolve unmatched UPC</p>
                  <p className="text-xs text-muted-foreground">
                    DataPlus checked the local catalog first. Quick create opens the product camera, saves up to eight photos with the UPC, quantity, and bin, then returns to scanning. Full product details can be completed later.
                  </p>
                </div>
                <div className="grid gap-2 rounded-md border bg-background/70 p-3 text-sm md:grid-cols-[minmax(0,1fr)_auto]">
                  <div>
                    <p className="font-medium">1. Catalog match</p>
                    <p className="text-muted-foreground">
                      No approved local SKU matches {manualUnknown.barcode}.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      disabled={quickCreateBusy || busy}
                      onClick={() => beginQuickCreate(manualUnknown)}
                    >
                      {quickCreateBusy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />} Quick create
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void startManualSkuCreation()}
                    >
                      <Pencil className="size-4" /> Full create
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={upcResearchBusy || busy}
                      onClick={() => void researchUnknownUpc()}
                    >
                      {upcResearchBusy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                      Ask AI to research online
                    </Button>
                    <Badge variant="outline">AI is optional</Badge>
                  </div>
                </div>
                {upcResearch && (
                  <div className="ai-result-surface grid gap-2 rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">
                        Online research {upcResearch.found === true ? "suggestion" : "found no reliable match"}
                      </span>
                      {upcResearch.found === true && (
                        <Badge variant="secondary">
                          {Math.round(Number(upcResearch.confidence || 0) * 100)}% confidence
                        </Badge>
                      )}
                    </div>
                    {Boolean(upcResearch.summary) && (
                      <p>{String(upcResearch.summary)}</p>
                    )}
                    {Array.isArray(upcResearch.sources) && upcResearch.sources.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {(upcResearch.sources as Array<Record<string, unknown>>).map((source, index) => (
                          <a
                            key={`${String(source.url)}-${index}`}
                            href={String(source.url || "#")}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            <ExternalLink className="size-3" />
                            {String(source.title || source.url || "Source")}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <div>
                  <p className="font-medium">Create catalog SKU</p>
                  <p className="text-xs text-muted-foreground">
                    Review any suggestion below, then create a draft SKU. Nothing is created until you choose Create catalog SKU.
                  </p>
                </div>
                <div className="warehouse-audit-sku-fields grid grid-cols-2 gap-3 lg:grid-cols-6">
                  <Field label="UPC">
                    <Input value={manualUnknown.barcode} disabled />
                  </Field>
                  <Field label="DataPlus SKU">
                    <Input
                      value={manualUnknown.sku}
                      disabled
                      readOnly
                      placeholder={manualSkuLoading ? "Generating SKU..." : "Generated automatically"}
                    />
                  </Field>
                  <div className="col-span-2 lg:col-span-1"><Field label="Product name">
                    <Input
                      ref={manualTitleRef}
                      value={manualUnknown.title}
                      onChange={(event) =>
                        setManualUnknown((entry) =>
                          entry
                            ? { ...entry, title: event.target.value }
                            : entry,
                        )
                      }
                      placeholder="Required product name"
                    />
                  </Field></div>
                  <Field label="Bin / location">
                    {activeAuditBins.length ? (
                      <Select
                        value={manualUnknown.locationBin || "__unassigned"}
                        onValueChange={(value) =>
                          setManualUnknown((entry) =>
                            entry
                              ? {
                                  ...entry,
                                  locationBin:
                                    value === "__unassigned" ? "" : value,
                                }
                              : entry,
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select bin" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__unassigned">
                            No bin selected
                          </SelectItem>
                          {activeAuditBins.map((bin) => (
                            <SelectItem
                              key={String(bin.id || bin.code)}
                              value={String(bin.code)}
                            >
                              {String(bin.code)}
                              {bin.nickname
                                ? ` - ${String(bin.nickname)}`
                                : bin.name
                                  ? ` - ${String(bin.name)}`
                                  : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={manualUnknown.locationBin}
                        onChange={(event) =>
                          setManualUnknown((entry) =>
                            entry
                              ? {
                                  ...entry,
                                  locationBin: event.target.value,
                                }
                              : entry,
                          )
                        }
                        placeholder="Bin or area"
                      />
                    )}
                  </Field>
                  <Field label="Quantity">
                    <Input
                      type="number"
                      min="1"
                      value={manualUnknown.qty}
                      onChange={(event) =>
                        setManualUnknown((entry) =>
                          entry ? { ...entry, qty: event.target.value } : entry,
                        )
                      }
                    />
                  </Field>
                  <Field label="Product photos (up to 8)">
                    <div className="grid gap-2">
                    <div className="flex flex-wrap gap-2">
                      <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted">
                        <Camera className="size-4" /> Take photo
                        <input
                          className="sr-only"
                          type="file"
                          accept="image/*"
                          capture="environment"
                          onChange={(event) => {
                            void readManualPhotos(event.currentTarget.files);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                      <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted">
                        <FileUp className="size-4" /> Add photos
                        <input
                          className="sr-only"
                        type="file"
                        accept="image/*"
                        multiple
                          onChange={(event) => {
                            void readManualPhotos(event.currentTarget.files);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                      <Button
                        type="button"
                        size="sm"
                        disabled={!manualPhotoUrls.length || photoAnalysisBusy}
                        onClick={() => void analyzeManualPhotos()}
                      >
                        {photoAnalysisBusy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                        Analyze {Math.min(manualPhotoUrls.length, 2) || ""} photo{Math.min(manualPhotoUrls.length, 2) === 1 ? "" : "s"}
                      </Button>
                    </div>
                    {photoAnalysisBusy || photoAnalysisStatus === "analyzing" ? (
                      <p className="flex items-center gap-2 text-xs font-medium text-primary">
                        <Loader2 className="size-3.5 animate-spin" />
                        David is reading the first {Math.min(manualPhotoUrls.length, 2)} photo{Math.min(manualPhotoUrls.length, 2) === 1 ? "" : "s"} and suggesting product details...
                      </p>
                    ) : photoAnalysisStatus === "ready" ? (
                      <p className="flex items-center gap-2 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="size-3.5" />
                        AI suggestions are ready to review.
                      </p>
                    ) : photoAnalysisStatus === "error" ? (
                      <p className="text-xs text-amber-700 dark:text-amber-400">
                        AI could not read these photos. You can still complete the SKU manually.
                      </p>
                    ) : null}
                    </div>
                  </Field>
                </div>
                <Collapsible key={manualUnknown.barcode}>
                  <CollapsibleTrigger asChild><Button variant="ghost" className="w-full justify-between px-0"><span>Optional product details</span><ChevronDown className="size-4" /></Button></CollapsibleTrigger>
                  <CollapsibleContent>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label="Brand">
                    <Input value={manualUnknown.brand || ""} onChange={(event) => setManualUnknown((entry) => entry ? { ...entry, brand: event.target.value } : entry)} placeholder="Optional" />
                  </Field>
                  <Field label="Manufacturer">
                    <Input value={manualUnknown.manufacturer || ""} onChange={(event) => setManualUnknown((entry) => entry ? { ...entry, manufacturer: event.target.value } : entry)} placeholder="Optional" />
                  </Field>
                  <Field label="Manufacturer part number">
                    <Input value={manualUnknown.mfrPartNumber || ""} onChange={(event) => setManualUnknown((entry) => entry ? { ...entry, mfrPartNumber: event.target.value } : entry)} placeholder="Optional" />
                  </Field>
                  <Field label="Pack quantity">
                    <Input value={manualUnknown.packQuantity || ""} onChange={(event) => setManualUnknown((entry) => entry ? { ...entry, packQuantity: event.target.value } : entry)} placeholder="Optional" />
                  </Field>
                  <Field label="Vendor SKU">
                    <Input value={manualUnknown.vendorSku || ""} onChange={(event) => setManualUnknown((entry) => entry ? { ...entry, vendorSku: event.target.value } : entry)} placeholder="Optional" />
                  </Field>
                  <Field label="Suggested category">
                    <Input value={manualUnknown.category || ""} onChange={(event) => setManualUnknown((entry) => entry ? { ...entry, category: event.target.value } : entry)} placeholder="Optional" />
                  </Field>
                  <div className="grid gap-1.5 sm:col-span-2">
                    <Label>Short description</Label>
                    <Input value={manualUnknown.shortDescription || ""} onChange={(event) => setManualUnknown((entry) => entry ? { ...entry, shortDescription: event.target.value } : entry)} placeholder="Optional" />
                  </div>
                </div>
                  </CollapsibleContent>
                </Collapsible>
                {manualPhotoUrls.length > 0 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto rounded-md border bg-background/70 p-1.5">
                    {manualPhotoUrls.map((photo, index) => (
                      <div key={`${photo.slice(-24)}-${index}`} className="group relative shrink-0">
                        <img src={photo} alt={`New product photo ${index + 1}`} className="size-10 rounded border object-cover" />
                        <Button
                          type="button"
                          size="icon"
                          variant="secondary"
                          className="absolute -right-1 -top-1 size-4 rounded-full p-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                          title={`Remove photo ${index + 1}`}
                          onClick={() => removeManualPhoto(index)}
                        >
                          <X className="size-2.5" />
                        </Button>
                      </div>
                    ))}
                    <p className="shrink-0 pl-1 text-[11px] text-muted-foreground">{manualPhotoUrls.length} saved · David reviews first {Math.min(manualPhotoUrls.length, 2)}</p>
                  </div>
                )}
                <div className="sticky bottom-0 z-10 flex w-full flex-wrap justify-center gap-2 border-t bg-background/95 px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3 backdrop-blur sm:static sm:justify-end sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setManualUnknown(null);
                      setManualPhotoUrls([]);
                      setManualQuickCreateClientId("");
                    }}
                  >
                    <X className="size-4" /> Skip for now
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={quickCreateBusy || busy || Number(manualUnknown.qty || 0) <= 0}
                    onClick={() => beginQuickCreate(manualUnknown)}
                  >
                    {quickCreateBusy ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />} Quick create
                  </Button>
                  <Button
                    size="sm"
                    disabled={
                      busy ||
                      manualSkuLoading ||
                      !manualUnknown.title.trim() ||
                      Number(manualUnknown.qty || 0) <= 0
                    }
                    onClick={() => void saveManualUnknown()}
                  >
                    <Plus className="size-4" /> Create catalog SKU
                  </Button>
                </div>
              </div>
            )}
            <div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">Audit items</p><WarehouseAuditSortControl value={itemSort} onChange={setItemSort} items /></div>
            <div className="overflow-x-auto rounded-md border">
              <Table className="warehouse-audit-table">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-14">Scan</TableHead>
                    <TableHead>UPC</TableHead>
                    <TableHead>Working SKU</TableHead>
                    <TableHead>Supplier</TableHead>
                    <TableHead>Vendor SKU</TableHead>
                    <TableHead>Manufacturer SKU</TableHead>
                    <TableHead>Cost</TableHead>
                    <TableHead>Bin</TableHead>
                    <TableHead>On PO</TableHead>
                    <TableHead>PO</TableHead>
                    <TableHead className="text-right">Expected</TableHead>
                    <TableHead>Counted</TableHead>
                    <TableHead className="text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedItems.map((line) => {
                    const poLine = line.receivingPoLine && typeof line.receivingPoLine === "object" ? line.receivingPoLine as Record<string, unknown> : null;
                    const poNumber = String(poLine?.poNumber || receivingReview?.documentNumber || "").trim();
                    const expectedQty = poLine ? Number(poLine.expectedQty ?? poLine.quantity ?? 0) : 0;
                    const rowCountedQty = Number(line.countedQty ?? line.count ?? 0);
                    const poMatchBadge = poLine ? <Badge className="border-yellow-400 bg-yellow-100 text-yellow-950 dark:border-yellow-600 dark:bg-yellow-400/20 dark:text-yellow-100" variant="outline" title={line.receivingMatchBasis === "vendor_sku" ? "Matched by vendor SKU" : line.receivingMatchBasis === "upc" ? "Matched by UPC" : line.receivingMatchBasis === "sku" ? "Matched by catalog SKU" : "Expected from packing slip"}><CheckCircle2 className="mr-1 size-3" /> Yes</Badge> : <span className="text-xs text-muted-foreground">No</span>;
                    const poStatusBadge = poLine ? rowCountedQty === expectedQty ? <Badge className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200" variant="outline"><CheckCircle2 className="mr-1 size-3" /> Matched</Badge> : <Badge variant="destructive">Variance {rowCountedQty - expectedQty > 0 ? "+" : ""}{numberLabel(rowCountedQty - expectedQty)}</Badge> : null;
                    if (line.auditItemKind === "po_expected") {
                      return (<TableRow className="bg-yellow-50/50 dark:bg-yellow-400/5" key={`po-expected-${String(line.id)}`}>
                        <TableCell><span className="grid size-8 place-items-center rounded-full border border-yellow-400 bg-yellow-100 text-yellow-800 dark:border-yellow-700 dark:bg-yellow-400/15 dark:text-yellow-200"><FileText className="size-4" /></span></TableCell>
                        <TableCell className="font-mono text-xs">{String(line.upc || "-")}</TableCell>
                        <TableCell><span className="text-xs text-muted-foreground">Expected only</span></TableCell>
                        <TableCell>{String(current.supplierName || "-")}</TableCell>
                        <TableCell className="font-mono text-xs">{String(line.vendorItemNumber || "-")}</TableCell>
                        <TableCell className="font-mono text-xs">{String(line.manufacturerSku || "-")}</TableCell>
                        <TableCell>-</TableCell>
                        <TableCell>-</TableCell>
                        <TableCell>{poMatchBadge}</TableCell>
                        <TableCell className="font-mono text-xs">{poNumber || "-"}</TableCell>
                        <TableCell className="text-right font-medium">{numberLabel(expectedQty)}</TableCell>
                        <TableCell>0</TableCell>
                        <TableCell className="text-right"><Badge variant="outline">Not counted</Badge></TableCell>
                      </TableRow>);
                    }
                    if (line.auditItemKind === "unknown") {
                      const item = line;
                      return (<TableRow className="warehouse-audit-unknown" key={`unknown-${String(item.barcode)}-${String(item.locationBin || "")}`}>
                      <TableCell>
                        <span className="grid size-8 place-items-center rounded-full border border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/60 dark:text-red-300" title="Not found in the catalog"><X className="size-4" /></span>
                      </TableCell>
                      <TableCell className="font-mono font-medium">{String(item.barcode || "-")}</TableCell>
                      <TableCell>-</TableCell>
                      <TableCell><span className="text-xs text-muted-foreground">-</span></TableCell>
                      <TableCell>-</TableCell>
                      <TableCell>-</TableCell>
                      <TableCell>-</TableCell>
                      <TableCell>{String(item.locationBin || "-")}</TableCell>
                      <TableCell>{poMatchBadge}</TableCell>
                      <TableCell className="font-mono text-xs">{poNumber || "-"}</TableCell>
                      <TableCell className="text-right">{poLine ? numberLabel(expectedQty) : "-"}</TableCell>
                      <TableCell>{numberLabel(Number(item.count || 0))}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {itemNoteButton(item)}<Badge variant={item.createdProductSku ? "secondary" : "outline"}>{item.createdProductSku ? "SKU created" : "Needs details"}</Badge>
                          {!item.createdProductSku && auditStatus === "in_progress" && (
                            <>
                              <Button size="sm" variant="outline" disabled={busy || upcResearchBusy || photoAnalysisBusy} onClick={() => void reopenUnknownSku(item, "quick")}>
                                <Camera className="size-4" /> Quick create
                              </Button>
                              <Button size="sm" variant="outline" disabled={busy || upcResearchBusy || photoAnalysisBusy} onClick={() => void reopenUnknownSku(item, "full")}>
                                <Plus className="size-4" /> Create
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>);
                    }
                    const workingSku = String(line.selectedSupplierSku || line.sku || "");
                    const catalogSku = String(line.sku || "");
                    return (
                    <TableRow className={line.quickCreated ? "bg-amber-50/50 dark:bg-amber-400/5" : ""} key={`${String(line.productId || line.sku)}-${String(line.locationBin || "")}`}>
                      <TableCell>
                        {String(line.image || "") ? <button type="button" className="relative block size-10 overflow-hidden rounded-md border bg-muted" title="Open product image" data-no-image-preview onClick={() => setItemImage({ src: String(line.image), title: String(line.title || line.sku || "Item photo") })}><img src={String(line.image)} alt={String(line.sku || "Catalog item")} className="size-full object-cover" /><span className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-emerald-600 text-white shadow"><CheckCircle2 className="size-3" /></span></button> : <span className="grid size-8 place-items-center rounded-full border border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300" title="Catalog item matched"><CheckCircle2 className="size-4" /></span>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{String(line.selectedSupplierUpc || line.barcode || line.upc || "-")}</TableCell>
                      <TableCell className="font-medium">
                        {workingSku ? (
                          <div className="min-w-32"><a className="inline-flex min-h-11 items-center font-mono font-medium text-primary underline underline-offset-4" href={`/products/${encodeURIComponent(catalogSku || workingSku)}`} target="_blank" rel="noreferrer" title={`Open ${workingSku} product details`}>{workingSku}</a><Button size="icon" variant="ghost" aria-label={`Quick view ${workingSku}`} onClick={() => setQuickPreviewItem({ sku: workingSku, title: String(line.title || workingSku), defaultImage: String(line.image || "") })} title={`Preview ${workingSku}`}><Eye className="size-3.5" /></Button>{catalogSku && workingSku !== catalogSku && <p className="mt-0.5 text-xs text-muted-foreground">Matched from: {catalogSku}</p>}</div>
                        ) : "-"}
                      </TableCell>
                      <TableCell><AuditSupplierCell auditId={String(current?.id || "")} auditStatus={auditStatus} line={line} onLineUpdate={applyAuditLineUpdate} /></TableCell>
                      <TableCell className="font-mono text-xs">{String(line.selectedVendorSku || "-")}</TableCell>
                      <TableCell className="font-mono text-xs">{String(line.selectedManufacturerSku || "-")}</TableCell>
                      <TableCell>{Number(line.selectedSupplierCost || 0) > 0 ? moneyLabel(Number(line.selectedSupplierCost)) : "-"}</TableCell>
                      <TableCell>{String(line.locationBin || "-")}</TableCell>
                      <TableCell>{poMatchBadge}</TableCell>
                      <TableCell className="font-mono text-xs">{poNumber || "-"}</TableCell>
                      <TableCell className="text-right">{poLine ? numberLabel(expectedQty) : "-"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span>{numberLabel(Number(line.countedQty || 0))}</span>
                          {auditStatus === "in_progress" && <Button size="icon" variant="ghost" className="size-7" title="Edit audit item" onClick={() => openCountEdit(line)}><Pencil className="size-3.5" /></Button>}
                        </div>
                      </TableCell>
                      <TableCell className="text-right"><div className="flex flex-wrap items-center justify-end gap-1">{itemNoteButton(line)}{line.quickCreated ? <Badge variant="warning">Needs product details</Badge> : null}{Number(line.supplierCount || 0) >= 2 && !String(line.selectedSupplierName || "").trim() && <Badge className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" variant="outline">Supplier needed</Badge>}{poStatusBadge || <Badge className="border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200" variant="outline"><CheckCircle2 className="mr-1 size-3" /> Counted</Badge>}</div></TableCell>
                    </TableRow>
                    );
                  })}

                  {!lines.length && !unknowns.length && (
                    <TableRow>
                      <TableCell
                        colSpan={13}
                        className="h-20 text-center text-muted-foreground"
                      >
                        Scan the first UPC to begin counting.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {!mobile && desktopAuditTools && <Dialog open={auditToolsOpen} onOpenChange={setAuditToolsOpen}>
              <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader><DialogTitle>Import stock / eBay tools</DialogTitle><DialogDescription>Import a stock file for this audit or prepare found stock for eBay.</DialogDescription></DialogHeader>
            <div className="grid gap-3 rounded-md border bg-muted/20 p-3">
              <div className="grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">Found stock import</p>
                  <Badge variant="outline">{numberLabel(foundStockLines.length)} found-stock SKU{foundStockLines.length === 1 ? "" : "s"}</Badge>
                  {latestFoundStockSummary ? <Badge variant="secondary">{numberLabel(Number(latestFoundStockSummary.imported || 0))} last import</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">Upload physical stock from this warehouse, create reusable local SKUs, then queue eBay readiness for imported rows.</p>
                {latestFoundStockSummary ? <p className="text-xs text-muted-foreground">Latest: {numberLabel(Number(latestFoundStockSummary.matchedCatalog || 0))} catalog matches, {numberLabel(Number(latestFoundStockSummary.created || 0))} created, {numberLabel(Number(latestFoundStockSummary.reused || 0))} reused, {numberLabel(Number(latestFoundStockSummary.alreadyListed || 0))} already listed.</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex min-h-9 max-w-full break-all cursor-pointer items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted">
                  <FileUp className="size-4" />
                  {foundStockFileName || "Choose CSV"}
                  <input type="file" accept=".csv,text/csv" className="sr-only" disabled={auditStatus !== "in_progress" || foundStockImporting} onChange={(event) => void chooseFoundStockFile(event.target.files?.[0])} />
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={includeAlreadyListedFoundStock} onCheckedChange={(checked) => setIncludeAlreadyListedFoundStock(checked === true)} /> Include already listed in eBay prep</label>
                <Button size="sm" disabled={auditStatus !== "in_progress" || foundStockImporting || !foundStockCsv.trim()} onClick={() => void importFoundStockCsv()}>{foundStockImporting ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />} Import</Button>
                <Button size="sm" variant="outline" disabled={ebayReadinessBusy || !foundStockLines.length} onClick={() => void queueFoundStockEbayReadiness()}>{ebayReadinessBusy ? <Loader2 className="size-4 animate-spin" /> : <Store className="size-4" />} Get ready for eBay</Button>
              </div>
            </div>
                <DialogFooter><Button variant="outline" onClick={() => setAuditToolsOpen(false)}><X className="size-4" /> Close</Button></DialogFooter>
              </DialogContent>
            </Dialog>}
            <BinLabelDialog key={String(current.warehouseId || current.warehouseName)} open={binLabelsOpen} onOpenChange={setBinLabelsOpen} warehouse={String(current.warehouseName || "Warehouse")} bins={(selectedAuditWarehouse?.bins || []).map(bin => ({ code: String(bin.code || ""), name: String(bin.name || bin.nickname || ""), active: bin.active }))} />
            <Dialog open={Boolean(itemImage)} onOpenChange={(open) => !open && setItemImage(null)}><DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl" data-no-image-preview><DialogHeader><DialogTitle>{itemImage?.title || "Item photo"}</DialogTitle></DialogHeader>{itemImage && <button type="button" className="w-full cursor-zoom-out" aria-label="Close enlarged photo" onClick={() => setItemImage(null)}><img src={itemImage.src} alt={itemImage.title} className="max-h-[72dvh] w-full object-contain" /></button>}</DialogContent></Dialog>
            <Dialog open={Boolean(noteItem)} onOpenChange={(open) => { if (!open && !noteSaving) setNoteItem(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>Item note</DialogTitle><DialogDescription>{String(noteItem?.sku || noteItem?.barcode || "Audit item")}{noteItem?.locationBin ? ` · ${String(noteItem.locationBin)}` : ""}</DialogDescription></DialogHeader><Field label="Note"><Textarea aria-label="Item note" autoFocus value={itemNote} onChange={(event) => setItemNote(event.target.value)} maxLength={4000} rows={5} readOnly={auditStatus !== "in_progress"} disabled={noteSaving} placeholder="Condition, damage, packaging, or anything the reviewer should know" /></Field>{Boolean(noteItem?.noteUpdatedBy) && <p className="text-xs text-muted-foreground">Last saved by {String(noteItem?.noteUpdatedBy)} · {dateLabel(String(noteItem?.noteUpdatedAt || ""))}</p>}<DialogFooter><Button variant="outline" disabled={noteSaving} onClick={() => setNoteItem(null)}>Close</Button>{auditStatus === "in_progress" && <Button disabled={noteSaving} onClick={() => void saveItemNote()}>{noteSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}Save note</Button>}</DialogFooter></DialogContent></Dialog>
            <ProductDetailSheet sourceItem={quickPreviewItem} open={Boolean(quickPreviewItem)} onOpenChange={(open) => !open && setQuickPreviewItem(null)} />
            <Dialog open={Boolean(countEditLine)} onOpenChange={(open) => !open && setCountEditLine(null)}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Edit audit item</DialogTitle>
                  <DialogDescription>Correct this item’s quantity or bin before finishing the count. Changes are saved in the audit history.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4">
                  <div className="rounded-md border bg-muted/30 p-3 text-sm"><p className="font-medium">{String(countEditLine?.sku || "Audit line")}</p><p className="mt-1 text-muted-foreground">{String(countEditLine?.title || "")}</p><p className="mt-2 text-xs text-muted-foreground">Current count: {numberLabel(Number(countEditLine?.countedQty || 0))}{countEditLine?.locationBin ? ` in ${String(countEditLine.locationBin)}` : ""}</p></div>
                  <Field label="Correct counted quantity"><Input autoFocus type="number" min="0" step="1" value={countEditValue} onChange={(event) => setCountEditValue(event.target.value)} /></Field>
                  <Field label="Bin / location">{activeAuditBins.length ? <Select value={countEditBin || "__unassigned"} disabled={countEditBusy} onValueChange={setCountEditBin}><SelectTrigger aria-label="Item bin" className="w-full min-w-0"><SelectValue placeholder="Select bin" /></SelectTrigger><SelectContent><SelectItem value="__unassigned" disabled>No bin selected</SelectItem>{countEditBin && !activeAuditBins.some((bin) => String(bin.code) === countEditBin) && <SelectItem value={countEditBin} disabled>{countEditBin} (current)</SelectItem>}{activeAuditBins.map((bin) => <SelectItem key={String(bin.id || bin.code)} value={String(bin.code)}>{String(bin.code)}{bin.name ? ` - ${String(bin.name)}` : ""}</SelectItem>)}</SelectContent></Select> : <Input aria-label="Item bin" value={countEditBin} disabled={countEditBusy} onChange={(event) => setCountEditBin(event.target.value)} placeholder="Enter bin" />}</Field>
                  <Field label="Reason"><Textarea value={countEditNote} onChange={(event) => setCountEditNote(event.target.value)} placeholder="Example: carton was scanned twice" /></Field>
                </div>
                <DialogFooter><Button variant="outline" onClick={() => setCountEditLine(null)}>Cancel</Button><Button disabled={countEditBusy} onClick={() => void saveCountEdit()}>{countEditBusy && <Loader2 className="size-4 animate-spin" />} Save item</Button></DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </CardContent>
    </Card>{createVendorDialog}</>
  );
}


export { WarehouseWorkspace }

function WarehouseMobileRoute({ canPurchase, returns, fulfillment, inventory, account, brand, canReceive, canManageBins, canAudit, operatorName, purchaseOrder, warehouses }: {
  canPurchase: boolean
  returns: ReactNode
  fulfillment: ReactNode
  inventory: ReactNode
  account: ReactNode
  brand: ReactNode
  canReceive: boolean
  canManageBins: boolean
  canAudit: boolean
  operatorName: string
  purchaseOrder: (id: string) => ReactNode
  warehouses: Array<Record<string, unknown>>
}) {
  return <WarehouseMobile
    canPurchase={canPurchase}
    returns={returns}
    fulfillment={fulfillment}
    inventory={inventory}
    account={account}
    brand={brand}
    receiving={canReceive ? <InboundReceivingLauncher mobile operatorName={operatorName} /> : <p>Receiving access is required.</p>}
    manual={canReceive ? <ManualReceivingPanel mobile /> : <p>Receiving access is required.</p>}
    outbound={<OutboundAuditWorkspace warehouses={warehouses} />}
    bins={canManageBins ? <WarehouseBinManager mobile /> : <p>Bin access is required.</p>}
    audits={canAudit ? <><WarehouseAuditPanel createOnly mobile operatorName={operatorName} /><WarehouseAuditHistory mobile /></> : <p>Audit access is required.</p>}
    audit={(id) => canAudit ? <WarehouseAuditPanel key={id} auditId={id} mobile /> : <p>Audit access is required.</p>}
    purchaseOrder={purchaseOrder}
  />
}

void PickScanPanel

export { WarehouseMobileRoute }
