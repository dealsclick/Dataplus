import { Alert,AlertDescription,AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card,CardContent,CardDescription,CardHeader,CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Empty,EmptyDescription,EmptyHeader,EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
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
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Database,
  ExternalLink,
  FileWarning,
  History,
  ListChecks,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ScanSearch,
  Search,
  Share2,
  ShoppingBag,
  Store,
  Trash2,
  Truck,
  Warehouse
} from "lucide-react"
import { useEffect,useMemo,useState } from "react"
import { toast } from "sonner"
import type {
  Brand,
  BrandSummary,
  ProductItem,
  Vendor,
  VendorMarketplaceCoverage,
  VendorMarketplaceSummary,
  VendorSupplierLocation
} from "../App"
import {
  LoadingState
} from "../App"
import { loadAppReferences } from "../lib/app-state"
import { api,dateLabel,moneyLabel,numberLabel } from "../lib/client-api"
import { VendorCreateDialog } from "./vendor-create-dialog"

import { Detail,Field,MetricCard,PageHeader,ToggleField } from "./app-ui"
import { CatalogImage,PriceModeSelect,VendorFeedScheduleManager } from "./product-workspaces"
import {
  dropshipReasonOptions,
  normalizeVendorDeliverySchedule,
  normalizeVendorScheduleExceptions,
  normalizeVendorTemporaryScheduleOverride,
  PURCHASE_WEEKDAYS,
  purchaseScheduleDateLabel,
  purchaseScheduleTimeLabel,
  type VendorDeliveryScheduleRow,
  type VendorScheduleException,
  type VendorTemporaryScheduleOverride,
} from "./purchasing-workspaces"

const emptyVendorMarketplaceCoverage: VendorMarketplaceCoverage = {
  productCount: 0,
  activeProductCount: 0,
  shopifyLive: 0,
  ebayLive: 0,
  marketplaceLive: 0,
  matchedSuppliers: []
}

function vendorMarketplaceCoverage(vendor: Vendor, rowsBySupplier: Map<string, VendorMarketplaceSummary>): VendorMarketplaceCoverage {
  const sourceCodes = new Set((Array.isArray(vendor.catalogSettings?.sourceCodes) ? vendor.catalogSettings.sourceCodes : [])
    .map((value) => String(value || "").trim().toLowerCase())
    .filter(Boolean))
  const seen = new Set<string>()
  const coverage = { ...emptyVendorMarketplaceCoverage, matchedSuppliers: [] as string[] }
  for (const row of rowsBySupplier.values()) {
    const rowCodes = (row.sourceCodes || []).map((value) => String(value || "").trim().toLowerCase()).filter(Boolean)
    if (!rowCodes.some((code) => sourceCodes.has(code))) continue
    if (!row || seen.has(row.supplierKey)) continue
    seen.add(row.supplierKey)
    coverage.productCount += Number(row.productCount || 0)
    coverage.activeProductCount += Number(row.activeProductCount || 0)
    coverage.shopifyLive += Number(row.shopifyLive || 0)
    coverage.ebayLive += Number(row.ebayLive || 0)
    coverage.marketplaceLive += Number(row.marketplaceLive || 0)
    coverage.matchedSuppliers.push(row.supplier)
  }
  return coverage
}

function brandLogo(brand: Brand) {
  return brand.logoDataUrl || brand.logoUrl || ""
}

function openBrand(brand: BrandSummary | Brand) {
  const identifier = brand.id || encodeURIComponent(brand.name)
  const query = brand.id ? "" : `?name=${encodeURIComponent(brand.name)}`
  window.history.pushState({}, "", `/brands/${identifier}${query}`)
  window.dispatchEvent(new PopStateEvent("popstate"))
}

function BrandLogo({ brand, size = "size-10" }: { brand: Brand; size?: string }) {
  const src = brandLogo(brand)
  if (src) return <CatalogImage src={src} alt={`${brand.name} logo`} className={`${size} shrink-0`} imageClassName="p-1" />
  return <div className={`grid shrink-0 place-items-center rounded-md border bg-muted text-xs font-bold text-muted-foreground ${size}`}>{brand.name.slice(0, 2).toUpperCase()}</div>
}

function BrandEditorDialog({
  open,
  onOpenChange,
  brand,
  vendors,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  brand?: Brand
  vendors: Vendor[]
  onSave: (patch: Record<string, unknown>) => Promise<void>
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setDraft({
      name: brand?.name || "",
      status: brand?.status || "active",
      category: brand?.category || "",
      website: brand?.website || "",
      logoUrl: brand?.logoUrl || "",
      logoDataUrl: brand?.logoDataUrl || "",
      mapPolicy: brand?.mapPolicy || "",
      mapPricingMode: brand?.mapPricingMode || "inherit",
      warranty: brand?.warranty || "",
      leadTimeNotes: brand?.leadTimeNotes || "",
      notes: brand?.notes || "",
      preferredVendorId: brand?.preferredVendorId || "none",
      vendorIds: brand?.vendorIds || [],
    })
  }, [brand, open])
  const value = (field: string) => String(draft[field] || "")
  const vendorIds = Array.isArray(draft.vendorIds) ? draft.vendorIds.map(String) : []
  function update(field: string, next: unknown) { setDraft((current) => ({ ...current, [field]: next })) }
  function toggleVendor(vendorId: string, checked: boolean) {
    update("vendorIds", checked ? [...new Set([...vendorIds, vendorId])] : vendorIds.filter((id) => id !== vendorId))
  }
  async function useLogo(file?: File) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => update("logoDataUrl", String(reader.result || ""))
    reader.readAsDataURL(file)
  }
  async function save() {
    if (!value("name").trim()) { toast.error("Brand name is required."); return }
    setSaving(true)
    try {
      await onSave({ ...draft, preferredVendorId: value("preferredVendorId") === "none" ? "" : value("preferredVendorId") })
      onOpenChange(false)
    } finally { setSaving(false) }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-4xl">
      <DialogHeader><DialogTitle>{brand ? `Edit ${brand.name}` : "Create brand"}</DialogTitle><DialogDescription>Centralize commercial policy and the suppliers that carry this brand.</DialogDescription></DialogHeader>
      <Tabs defaultValue="profile">
        <TabsList className="w-full justify-start overflow-x-auto"><TabsTrigger value="profile">Profile</TabsTrigger><TabsTrigger value="commercial">Commercial</TabsTrigger><TabsTrigger value="vendors">Vendors</TabsTrigger><TabsTrigger value="notes">Notes</TabsTrigger></TabsList>
        <TabsContent value="profile" className="grid gap-4 pt-3">
          <div className="flex flex-wrap items-center gap-3"><BrandLogo brand={{ ...(brand || { id: "" }), name: value("name") || "BR", logoUrl: value("logoUrl"), logoDataUrl: value("logoDataUrl") }} size="size-16" /><div className="grid gap-1"><Label htmlFor="brand-logo">Brand logo</Label><Input id="brand-logo" type="file" accept="image/*" onChange={(event) => void useLogo(event.target.files?.[0])} /></div></div>
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Brand name"><Input value={value("name")} onChange={(event) => update("name", event.target.value)} /></Field><Field label="Status"><Select value={value("status") || "active"} onValueChange={(next) => update("status", next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem><SelectItem value="void">Void</SelectItem></SelectContent></Select></Field><Field label="Category"><Input value={value("category")} onChange={(event) => update("category", event.target.value)} placeholder="Optional brand category" /></Field><Field label="Website"><Input value={value("website")} onChange={(event) => update("website", event.target.value)} placeholder="https://" /></Field><Field label="Logo URL"><Input value={value("logoUrl")} onChange={(event) => update("logoUrl", event.target.value)} placeholder="Optional hosted logo URL" /></Field></div>
        </TabsContent>
        <TabsContent value="commercial" className="grid gap-4 pt-3 sm:grid-cols-2"><Field label="Minimum-price rule"><PriceModeSelect value={value("mapPricingMode") || "inherit"} onChange={(next) => update("mapPricingMode", next)} inherit /></Field><Field label="MAP policy notes"><Input value={value("mapPolicy")} onChange={(event) => update("mapPolicy", event.target.value)} placeholder="e.g. Enforce MAP" /></Field><Field label="Warranty"><Input value={value("warranty")} onChange={(event) => update("warranty", event.target.value)} placeholder="e.g. 1 year manufacturer warranty" /></Field><div className="sm:col-span-2"><Field label="Lead time notes"><Textarea value={value("leadTimeNotes")} onChange={(event) => update("leadTimeNotes", event.target.value)} placeholder="Supplier lead times, ordering notes, or exceptions" /></Field></div></TabsContent>
        <TabsContent value="vendors" className="grid gap-4 pt-3"><Field label="Preferred vendor"><Select value={value("preferredVendorId") || "none"} onValueChange={(next) => update("preferredVendorId", next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No preferred vendor</SelectItem>{vendors.map((vendor) => <SelectItem key={vendor.id} value={vendor.id}>{vendor.name}</SelectItem>)}</SelectContent></Select></Field><div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">{vendors.map((vendor) => <label key={vendor.id} className="flex cursor-pointer items-center gap-2 rounded-md border bg-background p-2 text-sm"><Checkbox checked={vendorIds.includes(vendor.id)} onCheckedChange={(checked) => toggleVendor(vendor.id, checked === true)} />{vendor.name}</label>)}</div></TabsContent>
        <TabsContent value="notes" className="pt-3"><Field label="Internal notes"><Textarea className="min-h-40" value={value("notes")} onChange={(event) => update("notes", event.target.value)} placeholder="Brand notes visible to the catalog and purchasing teams." /></Field></TabsContent>
      </Tabs>
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />}{brand ? "Save brand" : "Create brand"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

export function BrandsPage({ vendors, onCreateBrand }: { vendors: Vendor[]; onCreateBrand: (patch: Record<string, unknown>) => Promise<Brand> }) {
  const [rows, setRows] = useState<BrandSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("all")
  const [vendor, setVendor] = useState("all")
  const [open, setOpen] = useState(false)
  const load = async () => {
    setLoading(true)
    try { const result = await api<{ rows?: BrandSummary[] }>("/api/brands/summary"); setRows(result.rows || []) } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load brands.") } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const vendorNames = useMemo(() => new Map(vendors.map((item) => [item.id, item.name])), [vendors])
  const filtered = rows.filter((brand) => {
    const preferred = vendorNames.get(brand.preferredVendorId || "") || ""
    const mapped = (brand.vendorIds || []).map((id) => vendorNames.get(id) || "").join(" ")
    const text = `${brand.name} ${brand.category || ""} ${preferred} ${mapped} ${(brand.suppliers || []).join(" ")} ${brand.notes || ""}`.toLowerCase()
    return text.includes(query.toLowerCase()) && (status === "all" || String(brand.status || "active").toLowerCase() === status) && (vendor === "all" || brand.preferredVendorId === vendor || (brand.vendorIds || []).includes(vendor))
  })
  const catalogSkus = rows.reduce((sum, row) => sum + Number(row.sourceProductCount || 0), 0)
  return <div className="grid gap-5"><PageHeader eyebrow="Catalog" title="Brands" description="Manage brand policy, supplier relationships, catalog coverage, and marketplace performance in one place." action={<Button onClick={() => setOpen(true)}>Create brand</Button>} />
    <div className="grid gap-3 md:grid-cols-4"><MetricCard label="Brands" value={rows.length} icon={Store} /><MetricCard label="Catalog SKUs" value={catalogSkus} icon={Boxes} /><MetricCard label="Shopify live" value={rows.reduce((sum, row) => sum + row.shopifyLive, 0)} icon={ShoppingBag} /><MetricCard label="eBay listed" value={rows.reduce((sum, row) => sum + row.ebayListed, 0)} icon={ExternalLink} /></div>
    <Card><CardHeader className="gap-3 border-b"><div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><CardTitle className="text-base">Brand register</CardTitle><CardDescription>SKU and marketplace counts are calculated from the catalog database.</CardDescription></div><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="size-4" /> Refresh</Button></div><div className="grid gap-2 sm:grid-cols-3"><div className="relative"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search brand, supplier, notes" value={query} onChange={(event) => setQuery(event.target.value)} /></div><Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem><SelectItem value="void">Void</SelectItem></SelectContent></Select><Select value={vendor} onValueChange={setVendor}><SelectTrigger><SelectValue placeholder="Vendor" /></SelectTrigger><SelectContent><SelectItem value="all">All vendors</SelectItem>{vendors.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div></CardHeader>
      <CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Brand</TableHead><TableHead>Status</TableHead><TableHead>Preferred vendor</TableHead><TableHead className="text-right">Catalog SKUs</TableHead><TableHead className="text-right">In stock</TableHead><TableHead className="text-right">Shopify</TableHead><TableHead className="text-right">eBay</TableHead><TableHead>Last order</TableHead><TableHead className="text-right">Order value</TableHead></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={9} className="h-32 text-center text-muted-foreground"><Loader2 className="mx-auto size-5 animate-spin" />Loading brands</TableCell></TableRow> : filtered.map((brand) => <TableRow key={`${brand.id || "source"}-${brand.brandKey}`} className="cursor-pointer" onClick={() => openBrand(brand)}><TableCell><div className="flex items-center gap-3"><BrandLogo brand={brand} /><div className="min-w-0"><button className="block max-w-56 truncate text-left font-medium text-primary hover:underline">{brand.name}</button><p className="max-w-56 truncate text-xs text-muted-foreground">{brand.category || (brand.suppliers || []).slice(0, 2).join(", ") || "No category"}</p></div></div></TableCell><TableCell><Badge variant={String(brand.status || "active").toLowerCase() === "active" ? "success" : "outline"}>{brand.status || "active"}</Badge></TableCell><TableCell>{vendorNames.get(brand.preferredVendorId || "") || "-"}</TableCell><TableCell className="text-right tabular-nums">{numberLabel(brand.sourceProductCount)}</TableCell><TableCell className="text-right tabular-nums">{numberLabel(brand.sourceInStockCount)}</TableCell><TableCell className="text-right"><Badge variant={brand.shopifyLive ? "success" : "outline"}>{numberLabel(brand.shopifyLive)}</Badge></TableCell><TableCell className="text-right"><Badge variant={brand.ebayListed ? "info" : "outline"}>{numberLabel(brand.ebayListed)}</Badge></TableCell><TableCell>{dateLabel(brand.lastOrderAt)}</TableCell><TableCell className="text-right font-medium tabular-nums">{moneyLabel(brand.orderValue)}</TableCell></TableRow>)}{!loading && !filtered.length && <TableRow><TableCell colSpan={9} className="h-32 text-center text-muted-foreground">No brands match these filters.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
    <BrandEditorDialog open={open} onOpenChange={setOpen} vendors={vendors} onSave={async (patch) => { const brand = await onCreateBrand(patch); openBrand(brand) }} />
  </div>
}

export function BrandDetailPage({ vendors, onCreateBrand, onSaveBrand, onBrandAction }: { vendors: Vendor[]; onCreateBrand: (patch: Record<string, unknown>) => Promise<Brand>; onSaveBrand: (id: string, patch: Record<string, unknown>) => Promise<Brand>; onBrandAction: (id: string, action: "enable" | "disable" | "void") => Promise<void> }) {
  const pathPart = decodeURIComponent(window.location.pathname.replace(/\/+$/, "").split("/").pop() || "")
  const suppliedName = new URLSearchParams(window.location.search).get("name") || ""
  const [profile, setProfile] = useState<{ brand: Brand; summary: BrandSummary; products: ProductItem[]; page: number; limit: number; total: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const load = async () => { setLoading(true); try { const params = new URLSearchParams({ page: String(page), limit: "25", q }); if (suppliedName) params.set("name", suppliedName); else params.set("id", pathPart); setProfile(await api(`/api/brands/profile?${params}`)) } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load brand profile.") } finally { setLoading(false) } }
  useEffect(() => { void load() }, [page, q, pathPart, suppliedName])
  if (loading && !profile) return <LoadingState />
  if (!profile) return <Empty><EmptyHeader><EmptyTitle>Brand not found</EmptyTitle><EmptyDescription>This profile is unavailable.</EmptyDescription></EmptyHeader></Empty>
  const { brand, summary } = profile
  const preferredVendor = vendors.find((vendor) => vendor.id === brand.preferredVendorId)
  const mappedVendors = vendors.filter((vendor) => (brand.vendorIds || []).includes(vendor.id))
  async function save(patch: Record<string, unknown>) {
    if (!brand.id) { const created = await onCreateBrand({ name: brand.name }); const updated = await onSaveBrand(created.id, patch); setProfile((current) => current ? { ...current, brand: updated } : current); window.history.replaceState({}, "", `/brands/${created.id}`); return }
    const updated = await onSaveBrand(brand.id, patch); setProfile((current) => current ? { ...current, brand: updated } : current)
    void load()
  }
  return <div className="grid gap-5"><PageHeader eyebrow="Catalog / Brands" title={brand.name} description={`${brand.category || "Uncategorized"} / ${summary.sourceProductCount || 0} catalog SKUs`} action={<div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => window.history.back()}>Back to brands</Button><Button onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit brand</Button><DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" size="icon"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => brand.id && void onBrandAction(brand.id, "enable")}>Set active</DropdownMenuItem><DropdownMenuItem onClick={() => brand.id && void onBrandAction(brand.id, "disable")}>Set inactive</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" onClick={() => brand.id && void onBrandAction(brand.id, "void")}>Void brand</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div>} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><MetricCard label="Catalog SKUs" value={summary.sourceProductCount || 0} icon={Boxes} /><MetricCard label="In stock" value={summary.sourceInStockCount || 0} icon={CheckCircle2} /><MetricCard label="Shopify live" value={summary.shopifyLive || 0} icon={ShoppingBag} /><MetricCard label="eBay listed" value={summary.ebayListed || 0} icon={ExternalLink} /><MetricCard label="Order value" value={moneyLabel(summary.orderValue || 0)} icon={Database} /></div>
    <Tabs defaultValue="overview"><TabsList className="w-full justify-start overflow-x-auto"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="products">Products ({numberLabel(profile.total)})</TabsTrigger><TabsTrigger value="vendors">Vendors ({mappedVendors.length})</TabsTrigger><TabsTrigger value="performance">Performance</TabsTrigger></TabsList><TabsContent value="overview" className="grid gap-4 pt-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]"><Card><CardHeader><div className="flex items-center gap-3"><BrandLogo brand={brand} size="size-16" /><div><CardTitle>{brand.name}</CardTitle><CardDescription>{brand.website || "No brand website"}</CardDescription></div></div></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2"><Detail label="Status" value={brand.status || "active"} /><Detail label="Category" value={brand.category || "Uncategorized"} /><Detail label="Minimum-price rule" value={brand.mapPricingMode === "calculated" ? "Calculated only" : brand.mapPricingMode === "protected" ? "MAP/LAP protected" : "Inherit channel rule"} /><Detail label="MAP policy" value={brand.mapPolicy || "Not set"} /><Detail label="Warranty" value={brand.warranty || "Not set"} /><Detail label="Lead-time notes" value={brand.leadTimeNotes || "No notes"} /><Detail label="Last brand order" value={dateLabel(summary.lastOrderAt)} /></CardContent></Card><Card><CardHeader><CardTitle className="text-base">Commercial owner</CardTitle></CardHeader><CardContent className="grid gap-3"><Detail label="Preferred vendor" value={preferredVendor?.name || "Not assigned"} /><Detail label="Mapped suppliers" value={mappedVendors.map((vendor) => vendor.name).join(", ") || "Not assigned"} /><p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">{brand.notes || "No internal brand notes."}</p></CardContent></Card></TabsContent><TabsContent value="products" className="pt-4"><Card><CardHeader className="gap-3 border-b sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="text-base">Catalog products</CardTitle><CardDescription>Every source-catalog record associated with this brand.</CardDescription></div><div className="relative w-full sm:w-72"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input className="pl-8" value={q} onChange={(event) => { setQ(event.target.value); setPage(1) }} placeholder="Search SKU or title" /></div></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Product</TableHead><TableHead>SKU</TableHead><TableHead>Supplier</TableHead><TableHead>Category</TableHead><TableHead className="text-right">Stock</TableHead><TableHead className="text-right">Price</TableHead></TableRow></TableHeader><TableBody>{profile.products.map((product) => <TableRow key={`${product.sku}-${product.supplier}`}><TableCell><div className="flex items-center gap-2"><CatalogImage src={product.defaultImage} alt={product.title || product.sku || "Product"} className="size-9 shrink-0" imageClassName="p-0.5" /><a href={`/products/${encodeURIComponent(product.productCatalogSku || product.sku || "")}`} className="max-w-64 truncate font-medium text-primary hover:underline">{product.title || "Untitled product"}</a></div></TableCell><TableCell className="font-mono text-xs">{product.sku || "-"}</TableCell><TableCell>{product.supplier || "-"}</TableCell><TableCell className="max-w-64 truncate">{product.mainCategory || product.sourceCategory || "Uncategorized"}</TableCell><TableCell className="text-right tabular-nums">{numberLabel(product.stockQty ?? product.qty ?? 0)}</TableCell><TableCell className="text-right tabular-nums">{moneyLabel(product.websitePrice ?? product.price ?? 0)}</TableCell></TableRow>)}{!profile.products.length && <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">No catalog products match this search.</TableCell></TableRow>}</TableBody></Table></div>{profile.total > profile.limit && <div className="flex items-center justify-between border-t p-3 text-sm"><span>Page {profile.page} of {Math.max(1, Math.ceil(profile.total / profile.limit))}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={profile.page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={profile.page * profile.limit >= profile.total} onClick={() => setPage((current) => current + 1)}>Next</Button></div></div>}</CardContent></Card></TabsContent><TabsContent value="vendors" className="pt-4"><Card><CardHeader><CardTitle className="text-base">Suppliers carrying this brand</CardTitle><CardDescription>Use a preferred vendor for purchasing while preserving every approved supplier relationship.</CardDescription></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2">{mappedVendors.map((vendor) => <div key={vendor.id} className="flex items-center justify-between rounded-md border bg-background p-3"><div><p className="font-medium">{vendor.name}</p><p className="text-xs text-muted-foreground">{vendor.code || vendor.type || "Supplier"}</p></div>{vendor.id === brand.preferredVendorId && <Badge variant="success">Preferred</Badge>}</div>)}{!mappedVendors.length && <p className="text-sm text-muted-foreground">No supplier relationship has been assigned.</p>}</CardContent></Card></TabsContent><TabsContent value="performance" className="grid gap-4 pt-4 md:grid-cols-3"><MetricCard label="Orders" value={summary.orderCount || 0} icon={ShoppingBag} /><MetricCard label="Order value" value={moneyLabel(summary.orderValue || 0)} icon={Database} /><MetricCard label="Last order" value={dateLabel(summary.lastOrderAt)} icon={History} /></TabsContent></Tabs>
    <BrandEditorDialog open={editing} onOpenChange={setEditing} brand={brand} vendors={vendors} onSave={save} />
  </div>
}

export function VendorsPage({ vendors, onSaveVendor, onVendorCreated }: { vendors: Vendor[]; onSaveVendor: (id: string, patch: Record<string, unknown>) => Promise<void>; onVendorCreated: (vendor: Vendor) => void }) {
  const [query, setQuery] = useState("")
  const [createVendorOpen, setCreateVendorOpen] = useState(false)
  const [catalogFilter, setCatalogFilter] = useState("all")
  const [marketplaceFilter, setMarketplaceFilter] = useState("all")
  const [marketplaceRows, setMarketplaceRows] = useState<VendorMarketplaceSummary[]>([])
  const [marketplaceLoading, setMarketplaceLoading] = useState(true)
  const pathVendorId = decodeURIComponent((window.location.pathname.match(/^\/vendors\/([^/]+)/)?.[1] || ""))

  useEffect(() => {
    let cancelled = false
    void api<{ rows?: VendorMarketplaceSummary[] }>("/api/vendors/marketplace-summary")
      .then((result) => {
        if (!cancelled) setMarketplaceRows(result.rows || [])
      })
      .catch(() => {
        if (!cancelled) setMarketplaceRows([])
      })
      .finally(() => {
        if (!cancelled) setMarketplaceLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const marketplaceBySupplier = useMemo(() => new Map(marketplaceRows.map((row) => [String(row.supplierKey || "").toLowerCase(), row])), [marketplaceRows])
  const coverageByVendor = useMemo(() => new Map(vendors.map((vendor) => [vendor.id, vendorMarketplaceCoverage(vendor, marketplaceBySupplier)])), [vendors, marketplaceBySupplier])
  const catalogEnabled = (vendor: Vendor) => vendor.catalogSettings?.enabled === true
  const filtered = vendors.filter((vendor) => {
    const coverage = coverageByVendor.get(vendor.id) || emptyVendorMarketplaceCoverage
    const matchesQuery = `${vendor.name} ${vendor.code || ""} ${vendor.email || ""} ${coverage.matchedSuppliers.join(" ")}`.toLowerCase().includes(query.toLowerCase())
    const matchesCatalog = catalogFilter === "all" || (catalogFilter === "included" ? catalogEnabled(vendor) : !catalogEnabled(vendor))
    const matchesMarketplace = marketplaceFilter === "all"
      || (marketplaceFilter === "shopify-live" && coverage.shopifyLive > 0)
      || (marketplaceFilter === "ebay-live" && coverage.ebayLive > 0)
      || (marketplaceFilter === "any-live" && coverage.marketplaceLive > 0)
      || (marketplaceFilter === "no-live" && coverage.marketplaceLive === 0)
    return matchesQuery && matchesCatalog && matchesMarketplace
  })
  const pathVendor = vendors.find((vendor) => vendor.id === pathVendorId)
  const enabledCount = vendors.filter(catalogEnabled).length
  const shopifyVendorCount = vendors.filter((vendor) => (coverageByVendor.get(vendor.id)?.shopifyLive || 0) > 0).length
  const ebayVendorCount = vendors.filter((vendor) => (coverageByVendor.get(vendor.id)?.ebayLive || 0) > 0).length

  if (pathVendorId) {
    if (!pathVendor) return <div className="grid gap-4"><PageHeader eyebrow="Suppliers" title="Supplier not found" description="This supplier link is no longer available or you do not have access." action={<Button asChild variant="outline"><a href="/vendors">Back to suppliers</a></Button>} /></div>
    return <div className="grid gap-5">
      <PageHeader eyebrow="Suppliers / Supplier profile" title={pathVendor.name} description="A dedicated, shareable supplier workspace for rules, locations, feeds, purchasing, and catalog controls." action={<div className="flex flex-wrap gap-2"><Button asChild variant="outline"><a href="/vendors"><ArrowLeft className="size-4" /> All suppliers</a></Button><Button variant="outline" onClick={() => void navigator.clipboard.writeText(window.location.href).then(() => toast.success("Supplier link copied."))}><Share2 className="size-4" /> Copy link</Button></div>} />
      <VendorDetail vendor={pathVendor} onSave={onSaveVendor} marketplaceCoverage={coverageByVendor.get(pathVendor.id) || emptyVendorMarketplaceCoverage} marketplaceLoading={marketplaceLoading} />
    </div>
  }

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="Suppliers"
        title="Vendors"
        description="Choose which supplier feeds participate in the managed catalog, then review their current Shopify and eBay coverage."
        action={<div className="flex flex-wrap gap-2"><Button onClick={() => setCreateVendorOpen(true)}><Plus className="size-4" /> New vendor</Button><Button asChild variant="outline"><a href="/vendor-category-mappings"><ListChecks className="size-4" /> Vendor mappings</a></Button></div>}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Supplier profiles" value={numberLabel(vendors.length)} icon={Store} />
        <MetricCard label="Catalog enabled" value={numberLabel(enabledCount)} icon={CheckCircle2} />
        <MetricCard label="Shopify suppliers" value={marketplaceLoading ? "Loading" : shopifyVendorCount} icon={ShoppingBag} />
        <MetricCard label="eBay suppliers" value={marketplaceLoading ? "Loading" : ebayVendorCount} icon={Store} />
      </div>
      <div className="grid gap-4">
        <Card>
          <CardHeader className="gap-3 border-b">
            <div>
              <CardTitle className="text-base">Supplier profiles</CardTitle>
              <CardDescription>Filter by catalog participation or marketplace coverage.</CardDescription>
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search vendor, code, or feed name" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select value={catalogFilter} onValueChange={setCatalogFilter}>
                <SelectTrigger><SelectValue placeholder="Catalog" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All catalog states</SelectItem>
                  <SelectItem value="included">Included in catalog</SelectItem>
                  <SelectItem value="excluded">Excluded from catalog</SelectItem>
                </SelectContent>
              </Select>
              <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
                <SelectTrigger><SelectValue placeholder="Marketplace" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All marketplace coverage</SelectItem>
                  <SelectItem value="any-live">Any marketplace live</SelectItem>
                  <SelectItem value="shopify-live">Shopify live</SelectItem>
                  <SelectItem value="ebay-live">eBay live</SelectItem>
                  <SelectItem value="no-live">No marketplace live SKUs</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(query || catalogFilter !== "all" || marketplaceFilter !== "all") && <Button variant="ghost" size="sm" className="w-fit" onClick={() => { setQuery(""); setCatalogFilter("all"); setMarketplaceFilter("all") }}>Clear filters</Button>}
          </CardHeader>
          <CardContent className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
            <p className="px-1 text-xs text-muted-foreground sm:col-span-2 xl:col-span-3">{filtered.length} of {vendors.length} supplier profile{vendors.length === 1 ? "" : "s"}</p>
            {filtered.map((vendor) => {
              const coverage = coverageByVendor.get(vendor.id) || emptyVendorMarketplaceCoverage
              const included = catalogEnabled(vendor)
              return <Button
                key={vendor.id}
                asChild
                variant="outline"
                className="h-auto min-w-0 items-start justify-between gap-3 px-3 py-3 text-left"
              >
                <a href={`/vendors/${encodeURIComponent(vendor.id)}`}><span className="min-w-0">
                  <span className="block truncate font-medium">{vendor.name}</span>
                  <span className="block text-xs text-muted-foreground">{vendor.code || vendor.type || "Supplier"}</span>
                  <span className="mt-2 flex flex-wrap gap-1">
                    <Badge variant={included ? "success" : "outline"}>{included ? "Catalog" : "Excluded"}</Badge>
                    {marketplaceLoading ? <Badge variant="outline">Checking markets</Badge> : <>
                      <Badge variant="secondary">{numberLabel(coverage.productCount)} products</Badge>
                      {coverage.shopifyLive > 0 && <Badge variant="success">Shopify {numberLabel(coverage.shopifyLive)}</Badge>}
                      {coverage.ebayLive > 0 && <Badge variant="info">eBay {numberLabel(coverage.ebayLive)}</Badge>}
                      {coverage.marketplaceLive === 0 && <Badge variant="outline">No live SKUs</Badge>}
                    </>}
                  </span>
                </span>
                <Badge variant={String(vendor.status || "active").toLowerCase() === "active" ? "default" : "outline"}>{vendor.status || "active"}</Badge>
                </a>
              </Button>
            })}
            {!filtered.length && <p className="p-4 text-sm text-muted-foreground">No supplier profiles match those filters.</p>}
          </CardContent>
        </Card>
      </div>
      <VendorCreateDialog open={createVendorOpen} onOpenChange={setCreateVendorOpen} onCreated={(vendor) => { onVendorCreated(vendor); window.history.pushState({}, "", `/vendors/${encodeURIComponent(vendor.id)}`); window.dispatchEvent(new PopStateEvent("popstate")) }} />
    </div>
  )
}

type SupplierRetirementPreview = {
  previewId: string
  retired: boolean
  summary: { products: number; shopify: number; ebay: number; alternate_candidates: number; openPurchaseOrders: number; openOrders: number }
  samples: Array<{ sku: string; title: string; physicalQty: number }>
  purchaseOrders: Array<{ id: string; number: string; status: string }>
  orders: Array<{ id: string; number: string; status: string }>
}

function SupplierRetirementDialog({ vendor, open, onOpenChange, onApplied }: { vendor: Vendor; open: boolean; onOpenChange: (open: boolean) => void; onApplied: () => Promise<void> }) {
  const [preview, setPreview] = useState<SupplierRetirementPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState("")
  const [reason, setReason] = useState("")
  const [confirmName, setConfirmName] = useState("")
  const [job, setJob] = useState<{ id: string; jobNumber?: number } | null>(null)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true); setError(""); setPreview(null); setConfirmName("")
    void api<SupplierRetirementPreview>(`/api/vendors/${encodeURIComponent(vendor.id)}/retirement/preview`, { method: "POST", body: "{}" })
      .then(result => { if (!cancelled) setPreview(result) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load impact preview") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, vendor.id])
  async function apply() {
    if (!preview || applying) return
    setApplying(true); setError("")
    try {
      const result = await api<{ job: { id: string; jobNumber?: number } }>(`/api/vendors/${encodeURIComponent(vendor.id)}/retirement/apply`, { method: "POST", body: JSON.stringify({ previewId: preview.previewId, reason, confirmName }) })
      setJob(result.job)
      toast.success(`Retirement queued${result.job.jobNumber ? ` as Job #${result.job.jobNumber}` : ""}`)
      await onApplied()
    } catch (e) { setError(e instanceof Error ? e.message : "Retirement could not be queued") }
    finally { setApplying(false) }
  }
  return <Dialog open={open} onOpenChange={next => { if (!applying) onOpenChange(next) }}><DialogContent className="flex max-h-[90dvh] w-[calc(100%-1rem)] flex-col overflow-hidden sm:max-w-3xl"><DialogHeader><DialogTitle>Retire {vendor.name}</DialogTitle><DialogDescription>Supplier retirement preserves physical stock and history. Previously published channel quantities require a separate inventory sync.</DialogDescription></DialogHeader>
    <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
      {loading && <div role="status" className="flex items-center gap-2 py-6"><Loader2 className="size-4 animate-spin" />Calculating supplier impact...</div>}
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      {job ? <div role="status" className="space-y-2 border-l-2 border-amber-500 pl-3 text-sm"><p>Job {job.jobNumber ? `#${job.jobNumber}` : job.id} queued.</p><p>Local protections are being applied. Live channel inventory is not yet confirmed updated.</p><a className="underline" href="/jobs">Open Jobs</a></div> : preview && <>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">{[["Primary-source products", preview.summary.products], ["Shopify-linked products", preview.summary.shopify], ["eBay-linked products", preview.summary.ebay], ["Alternate candidates", preview.summary.alternate_candidates], ["Open purchase orders", preview.summary.openPurchaseOrders], ["Open customer orders", preview.summary.openOrders]].map(([label, count]) => <div key={String(label)}><dt className="text-muted-foreground">{label}</dt><dd className="font-semibold">{numberLabel(Number(count))}</dd></div>)}</dl>
        <div className="border-l-2 border-amber-500 pl-3 text-sm"><p>Retirement stops this supplier's feed schedules, replenishment and new purchase demand. Supplier-only products cannot launch. Physical inventory is retained.</p><p className="mt-2">Alternate matches require sourcing review. Open orders and POs are not canceled or reassigned. Review customer orders before changing fulfillment.</p><p className="mt-2 font-medium">After the job: run reviewed channel inventory syncs. Disabled channels and unsupported integrations need manual attention.</p></div>
        {preview.purchaseOrders.length > 0 && <div className="text-sm"><h3 className="font-semibold">Purchase orders to review</h3>{preview.purchaseOrders.slice(0, 20).map(po => <p key={po.id}>{po.number} · {po.status}</p>)}</div>}
        {preview.orders.length > 0 && <div className="text-sm"><h3 className="font-semibold">Customer orders to review (up to 50)</h3>{preview.orders.map(order => <p key={order.id}>{order.number} / {order.status}</p>)}</div>}
        <div className="overflow-x-auto"><Table className="table-fixed"><TableHeader><TableRow><TableHead className="w-2/3 whitespace-normal">Product sample (up to 50)</TableHead><TableHead className="whitespace-normal text-right">Verified physical qty</TableHead></TableRow></TableHeader><TableBody>{preview.samples.map(row => <TableRow key={row.sku}><TableCell className="whitespace-normal break-words"><span className="font-medium">{row.sku}</span><p className="text-xs text-muted-foreground">{row.title}</p></TableCell><TableCell className="text-right">{numberLabel(row.physicalQty)}</TableCell></TableRow>)}</TableBody></Table></div>
        {!preview.retired && <><Field label="Retirement reason"><Textarea maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} /></Field><Field label={`Confirm supplier name: ${vendor.name}`}><Input value={confirmName} onChange={e => setConfirmName(e.target.value)} autoComplete="off" /></Field></>}
      </>}
    </div><DialogFooter className="shrink-0 border-t pt-3"><Button variant="outline" disabled={applying} onClick={() => onOpenChange(false)}>Close</Button>{!job && !preview?.retired && <Button variant="destructive" disabled={loading || !preview || applying || reason.trim().length < 5 || confirmName !== vendor.name} onClick={() => void apply()}>{applying && <Loader2 className="size-4 animate-spin" />}Retire supplier</Button>}</DialogFooter>
  </DialogContent></Dialog>
}

export function VendorCatalogRefreshDialog({ vendor, open, onOpenChange }: { vendor: Vendor; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [summary, setSummary] = useState<{ total: number; unknownstatus: number; last_seen_at?: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [queuing, setQueuing] = useState(false)
  const [error, setError] = useState("")
  const [job, setJob] = useState<{ id: string; jobNumber?: number } | null>(null)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setSummary(null); setJob(null); setError(""); setLoading(true)
    void api<{ total: number; unknownstatus: number; last_seen_at?: string }>(`/api/vendors/${encodeURIComponent(vendor.id)}/catalog-refresh`)
      .then(result => { if (!cancelled) setSummary(result) })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : "Could not load stored records") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, vendor.id])
  async function run() {
    setQueuing(true); setError("")
    try {
      const result = await api<{ job: { id: string; jobNumber?: number } }>(`/api/vendors/${encodeURIComponent(vendor.id)}/catalog-refresh`, { method: "POST", body: "{}" })
      setJob(result.job)
    } catch (e) { setError(e instanceof Error ? e.message : "Could not queue catalog refresh") }
    finally { setQueuing(false) }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg flex-col overflow-hidden">
    <DialogHeader><DialogTitle>Refresh catalog from stored records</DialogTitle><DialogDescription className="break-words">Create eligible new catalog SKUs for {vendor.name} using source records already stored in DataPlus.</DialogDescription></DialogHeader>
    <div className="min-h-0 space-y-3 overflow-y-auto text-sm">
      <p>No FTP download or full datadump scan. Existing catalog products are skipped. This action does not publish listings or push prices or inventory.</p>
      <p>Inactive and discontinued records are excluded. Possible identifier matches and records missing their original active status require review in the job results.</p>
      {loading && <p role="status">Checking stored records…</p>}
      {summary && <p><strong>{numberLabel(summary.total)}</strong> stored source records. {summary.unknownstatus > 0 && <span>{numberLabel(summary.unknownstatus)} have no saved active status and may need review.</span>}</p>}
      {error && <p role="alert" className="text-destructive">{error}</p>}
      {job && <p role="status">Queued as JOB-{job.jobNumber || job.id}. View progress, skipped records and review results in Jobs.</p>}
    </div>
    <DialogFooter className="shrink-0 border-t pt-3 pb-[env(safe-area-inset-bottom)]"><Button variant="outline" disabled={queuing} onClick={() => onOpenChange(false)}>Close</Button>{job ? <Button asChild><a href="/jobs">View Jobs</a></Button> : <Button disabled={loading || queuing || !summary?.total || Boolean(error)} onClick={() => void run()}>{queuing ? "Queuing…" : "Refresh stored records"}</Button>}</DialogFooter>
  </DialogContent></Dialog>
}

type SupplierDropshipConversionPreview = {
  previewId: string
  summary: { eligibleLines: number; eligibleOrders: number; sourcePurchaseOrders: number; excludedLines: number }
  excluded: { submittedOrClosed: number; receivedOrMoved: number; terminalOrder: number; missingOrder: number; incompleteAddress: number; missingRoute: number }
  samples: Array<{ purchaseOrderId: string; purchaseOrderNumber: string; orderId: string; orderNumber: string; routeId: string; sku: string; qty: number }>
}

function SupplierDropshipConversionDialog({ vendor, open, onOpenChange }: { vendor: Vendor; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [preview, setPreview] = useState<SupplierDropshipConversionPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [reasonCode, setReasonCode] = useState("supplier_direct_only")
  const [reasonNote, setReasonNote] = useState("")
  const [error, setError] = useState("")
  const [job, setJob] = useState<{ id: string; jobNumber?: number } | null>(null)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true); setPreview(null); setError(""); setJob(null); setReasonCode("supplier_direct_only"); setReasonNote("")
    void api<SupplierDropshipConversionPreview>(`/api/vendors/${encodeURIComponent(vendor.id)}/dropship-conversion/preview`, { method: "POST", body: "{}" })
      .then((result) => { if (!cancelled) setPreview(result) })
      .catch((nextError) => { if (!cancelled) setError(nextError instanceof Error ? nextError.message : "Could not preview open demand") })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, vendor.id])
  async function apply() {
    if (!preview || applying) return
    setApplying(true); setError("")
    try {
      const result = await api<{ job: { id: string; jobNumber?: number } }>(`/api/vendors/${encodeURIComponent(vendor.id)}/dropship-conversion/apply`, { method: "POST", body: JSON.stringify({ previewId: preview.previewId, reasonCode, reasonNote: reasonNote.trim() }) })
      setJob(result.job)
      toast.success(`Dropship conversion queued${result.job.jobNumber ? ` as Job #${result.job.jobNumber}` : ""}`)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Could not queue dropship conversion")
    } finally {
      setApplying(false)
    }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!applying) onOpenChange(next) }}><DialogContent className="flex max-h-[90dvh] w-[calc(100%-1rem)] flex-col overflow-hidden sm:max-w-3xl"><DialogHeader><DialogTitle>Convert open {vendor.name} demand</DialogTitle><DialogDescription>Eligible unsubmitted and unreceived lines will move from pooled drafts into one direct-to-customer PO per customer order.</DialogDescription></DialogHeader>
    <div className="min-h-0 space-y-4 overflow-y-auto pr-1">
      {loading && <div role="status" className="flex items-center gap-2 py-6"><Loader2 className="size-4 animate-spin" />Reviewing open purchase demand...</div>}
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      {job ? <Alert className="border-blue-500/30 bg-blue-500/5"><Loader2 className="size-4 animate-spin" /><AlertTitle>Conversion queued</AlertTitle><AlertDescription>Job {job.jobNumber ? `#${job.jobNumber}` : job.id} will show line-level progress and review errors. <a className="underline" href="/jobs">Open Jobs</a></AlertDescription></Alert> : preview && <>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><Detail label="Eligible lines" value={numberLabel(preview.summary.eligibleLines)} /><Detail label="Customer orders" value={numberLabel(preview.summary.eligibleOrders)} /><Detail label="Source POs" value={numberLabel(preview.summary.sourcePurchaseOrders)} /><Detail label="Excluded lines" value={numberLabel(preview.summary.excludedLines)} /></div>
        <Alert className="border-amber-500/30 bg-amber-500/5"><AlertTriangle className="size-4" /><AlertTitle>Protected exclusions</AlertTitle><AlertDescription>Submitted or closed: {numberLabel(preview.excluded.submittedOrClosed)}; received or previously moved: {numberLabel(preview.excluded.receivedOrMoved)}; canceled or completed orders: {numberLabel(preview.excluded.terminalOrder)}; incomplete address: {numberLabel(preview.excluded.incompleteAddress)}; missing order or route: {numberLabel(preview.excluded.missingOrder + preview.excluded.missingRoute)}.</AlertDescription></Alert>
        {preview.samples.length > 0 && <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Customer order</TableHead><TableHead>Source PO</TableHead><TableHead>SKU</TableHead><TableHead className="text-right">Qty</TableHead></TableRow></TableHeader><TableBody>{preview.samples.map((row) => <TableRow key={`${row.purchaseOrderId}-${row.routeId}`}><TableCell>{row.orderNumber || row.orderId}</TableCell><TableCell>{row.purchaseOrderNumber || row.purchaseOrderId}</TableCell><TableCell>{row.sku}</TableCell><TableCell className="text-right">{numberLabel(row.qty)}</TableCell></TableRow>)}</TableBody></Table></div>}
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Conversion reason"><Select value={reasonCode} onValueChange={setReasonCode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{dropshipReasonOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></Field><Field label="Optional note"><Textarea value={reasonNote} maxLength={1000} onChange={(event) => setReasonNote(event.target.value)} placeholder="Add context only when needed" /></Field></div>
      </>}
    </div><DialogFooter className="shrink-0 border-t pt-3 pb-[env(safe-area-inset-bottom)]"><Button variant="outline" disabled={applying} onClick={() => onOpenChange(false)}>Close</Button>{!job && <Button disabled={loading || applying || !preview?.summary.eligibleLines} onClick={() => void apply()}>{applying ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />} Convert eligible demand</Button>}</DialogFooter>
  </DialogContent></Dialog>
}

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

function VendorDetail({ vendor, onSave, marketplaceCoverage = emptyVendorMarketplaceCoverage, marketplaceLoading = false }: { vendor: Vendor; onSave: (id: string, patch: Record<string, unknown>) => Promise<void>; marketplaceCoverage?: VendorMarketplaceCoverage; marketplaceLoading?: boolean }) {
  const [catalogRefreshOpen, setCatalogRefreshOpen] = useState(false)
  const [retirementOpen, setRetirementOpen] = useState(false)
  const [dropshipConversionOpen, setDropshipConversionOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<Record<string, unknown>>({})
  const [warehouses, setWarehouses] = useState<Array<Record<string, unknown>>>([])
  const [schedulePreview, setSchedulePreview] = useState<Array<Record<string, unknown>>>([])
  const [schedulePreviewLoading, setSchedulePreviewLoading] = useState(false)
  const [supplierLocationOpen, setSupplierLocationOpen] = useState(false)
  const [supplierLocationDraft, setSupplierLocationDraft] = useState<VendorSupplierLocation>(() => emptyVendorSupplierLocation(1))
  const value = (field: string, fallback = "") => String(draft[field] ?? (vendor as unknown as Record<string, unknown>)[field] ?? fallback)
  const addressValue = (field: string, fallback = "") => String(draft[`address.${field}`] ?? vendor.address?.[field as keyof NonNullable<Vendor["address"]>] ?? fallback)

  useEffect(() => {
    setEditing(false)
    setRetirementOpen(false)
    setCatalogRefreshOpen(false)
    setDropshipConversionOpen(false)
    setSupplierLocationOpen(false)
    setDraft({})
    setSchedulePreview([])
  }, [vendor.id])
  useEffect(() => { void loadAppReferences(["warehouses"]).then((state) => setWarehouses((state.warehouses || []) as Array<Record<string, unknown>>)).catch(() => undefined) }, [])

  function update(field: string, next: unknown) {
    setDraft((current) => ({ ...current, [field]: next }))
  }

  function updateAddress(field: string, next: unknown) {
    setDraft((current) => ({ ...current, [`address.${field}`]: next }))
  }

  async function save() {
    if (!Object.keys(draft).length) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onSave(vendor.id, draft)
      if (String(draft.status || "").toLowerCase() === "inactive" && String(vendor.status).toLowerCase() !== "inactive") {
        toast.info("Supplier inventory protection queued. Check Jobs for channel results and sourcing exceptions.", { action: { label: "Jobs", onClick: () => { window.location.href = "/jobs" } } })
      }
      setDraft({})
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  const inventoryRules = vendor.inventoryRules || {}
  const supplierLocations = (draft.supplierLocations ?? vendor.supplierLocations ?? []) as VendorSupplierLocation[]
  const managedSupplierWarehouses = warehouses.filter((warehouse) => warehouse.managedVendorLocation === true && String(warehouse.vendorId || "") === vendor.id)
  const vendorSafetyQtyEnabled = Boolean(draft["inventoryRules.safetyQtyEnabled"] ?? inventoryRules.safetyQtyEnabled ?? (inventoryRules.safetyQty !== null && inventoryRules.safetyQty !== undefined))
  const vendorSafetyQty = draft["inventoryRules.safetyQty"] !== undefined ? draft["inventoryRules.safetyQty"] : inventoryRules.safetyQty
  const pricingRules = vendor.pricingRules || {}
  const variationRules = vendor.variationRules || {}
  const sellingUnitMode = String(draft["variationRules.sellingUnitMode"] ?? variationRules.sellingUnitMode ?? "inherit")
  const inheritedIndividualUnits = variationRules.shopifyVariantMode === "each-and-uom" && variationRules.allowShopifyVariations !== false
  const allowIndividualUnits = sellingUnitMode === "individual-only" || sellingUnitMode === "individual-and-case" || (sellingUnitMode === "inherit" && inheritedIndividualUnits)
  const allowSupplierUnit = sellingUnitMode === "supplier-uom" || sellingUnitMode === "case-only" || sellingUnitMode === "individual-and-case" || sellingUnitMode === "inherit"
  const purchaseOrderRules = vendor.purchaseOrderRules || {}
  const submissionSettings = vendor.submissionSettings || {}
  const supplierDropshipSupported = Boolean(draft["purchaseOrderRules.dropShipEnabled"] ?? purchaseOrderRules.dropShipEnabled)
  const supplierDropshipAllOrders = Boolean(draft["purchaseOrderRules.dropShipAllOrders"] ?? purchaseOrderRules.dropShipAllOrders ?? (String(purchaseOrderRules.fulfillmentMode || "pooled") === "dropship_per_order"))
  const sourcePriority = vendor.sourcePriority || {}
  const catalogSettings = vendor.catalogSettings || {}
  const catalogSourceCodesValue = draft["catalogSettings.sourceCodes"] ?? catalogSettings.sourceCodes ?? []
  const catalogSourceCodes = Array.isArray(catalogSourceCodesValue) ? catalogSourceCodesValue.join(" | ") : String(catalogSourceCodesValue || "")
  const deliverySchedule = normalizeVendorDeliverySchedule(draft["purchaseOrderRules.deliverySchedule"] ?? purchaseOrderRules.deliverySchedule)
  const scheduleExceptions = normalizeVendorScheduleExceptions(draft["purchaseOrderRules.scheduleExceptions"] ?? purchaseOrderRules.scheduleExceptions)
  const temporaryScheduleOverride = normalizeVendorTemporaryScheduleOverride(draft["purchaseOrderRules.temporaryCutoffOverride"] ?? purchaseOrderRules.temporaryCutoffOverride)
  const weeklyScheduleEnabled = Boolean(draft["purchaseOrderRules.weeklyScheduleEnabled"] ?? purchaseOrderRules.weeklyScheduleEnabled ?? deliverySchedule.length > 0)
  const receivingDocumentTemplate = (draft.receivingDocumentTemplate ?? vendor.receivingDocumentTemplate ?? {}) as NonNullable<Vendor["receivingDocumentTemplate"]>
  const receivingColumns = receivingDocumentTemplate.columns || {}
  const receivingFieldRows = [
    ["vendorItemNumber", "Vendor item"],
    ["manufacturerSku", "Manufacturer SKU"],
    ["upc", "UPC / GTIN"],
    ["description", "Description"],
    ["quantity", "Received quantity"],
    ["poNumber", "PO number"],
    ["cartonNumber", "Carton number"],
  ] as const

  function updateReceivingTemplate(field: string, next: unknown) {
    update("receivingDocumentTemplate", { ...receivingDocumentTemplate, [field]: next })
  }

  function updateReceivingColumn(field: string, key: "label" | "startPercent" | "endPercent", next: unknown) {
    update("receivingDocumentTemplate", {
      ...receivingDocumentTemplate,
      columns: { ...receivingColumns, [field]: { ...(receivingColumns[field] || {}), [key]: next } },
    })
  }

  function openSupplierLocation(location?: VendorSupplierLocation) {
    setSupplierLocationDraft(location
      ? { ...location, address: { ...location.address }, sourceLocationIds: [...(location.sourceLocationIds || [])] }
      : emptyVendorSupplierLocation(supplierLocations.length + 1))
    setSupplierLocationOpen(true)
  }

  function updateSupplierLocation(field: string, next: unknown) {
    setSupplierLocationDraft((current) => field.startsWith("address.")
      ? { ...current, address: { ...current.address, [field.split(".")[1]]: String(next ?? "") } }
      : { ...current, [field]: next })
  }

  function stageSupplierLocation() {
    const name = supplierLocationDraft.name.trim()
    const code = supplierLocationDraft.code.trim()
    if (!name || !code) { toast.error("Location name and supplier location code are required."); return }
    if (supplierLocations.some((location) => location.id !== supplierLocationDraft.id && location.code.trim().toLowerCase() === code.toLowerCase())) {
      toast.error("Supplier location codes must be unique for this vendor.")
      return
    }
    const now = new Date().toISOString()
    const nextLocation = { ...supplierLocationDraft, name, code, updatedAt: now, createdAt: supplierLocationDraft.createdAt || now }
    const exists = supplierLocations.some((location) => location.id === nextLocation.id)
    update("supplierLocations", exists ? supplierLocations.map((location) => location.id === nextLocation.id ? nextLocation : location) : [...supplierLocations, nextLocation])
    setSupplierLocationOpen(false)
  }

  function setSupplierLocationStatus(location: VendorSupplierLocation, status: "active" | "inactive") {
    update("supplierLocations", supplierLocations.map((row) => row.id === location.id ? { ...row, status, updatedAt: new Date().toISOString() } : row))
  }

  function updateSellingUnitPermission(permission: "individual" | "supplier", enabled: boolean) {
    const nextIndividual = permission === "individual" ? enabled : allowIndividualUnits
    const nextSupplier = permission === "supplier" ? enabled : allowSupplierUnit
    if (!nextIndividual && !nextSupplier) {
      toast.error("Keep at least one selling unit enabled.")
      return
    }
    update("variationRules.sellingUnitMode", nextIndividual ? (nextSupplier ? "individual-and-case" : "individual-only") : "supplier-uom")
  }

  function updateDeliveryScheduleRow(id: string, field: keyof VendorDeliveryScheduleRow, next: unknown) {
    update("purchaseOrderRules.deliverySchedule", deliverySchedule.map((row) => row.id === id ? { ...row, [field]: next } : row))
  }

  function addDeliveryScheduleRow() {
    update("purchaseOrderRules.deliverySchedule", [...deliverySchedule, {
      id: `delivery-window-${Date.now()}`,
      cutoffDay: 2,
      cutoffTime: "16:00",
      deliveryDay: 3,
      enabled: true,
      label: "",
    }])
  }

  function setWeeklyScheduleEnabled(next: boolean) {
    update("purchaseOrderRules.weeklyScheduleEnabled", next)
    if (next && !deliverySchedule.length) addDeliveryScheduleRow()
  }

  function updateScheduleException(id: string, field: keyof VendorScheduleException, next: unknown) {
    update("purchaseOrderRules.scheduleExceptions", scheduleExceptions.map((row) => row.id === id ? { ...row, [field]: next } : row))
  }

  function addScheduleException() {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    update("purchaseOrderRules.scheduleExceptions", [...scheduleExceptions, {
      id: `schedule-exception-${Date.now()}`,
      date: tomorrow,
      label: "Supplier closed",
      enabled: true,
    }])
  }

  function updateTemporaryScheduleOverride(field: keyof VendorTemporaryScheduleOverride, next: unknown) {
    update("purchaseOrderRules.temporaryCutoffOverride", { ...temporaryScheduleOverride, [field]: next })
  }

  async function previewPurchaseSchedule() {
    setSchedulePreviewLoading(true)
    try {
      const pendingRules = Object.fromEntries(Object.entries(draft)
        .filter(([key]) => key.startsWith("purchaseOrderRules."))
        .map(([key, next]) => [key.slice("purchaseOrderRules.".length), next]))
      const result = await api<{ windows?: Array<Record<string, unknown>> }>(`/api/vendors/${encodeURIComponent(vendor.id)}/purchase-schedule/preview`, {
        method: "POST",
        body: JSON.stringify({ purchaseOrderRules: { ...purchaseOrderRules, ...pendingRules }, count: 6 }),
      })
      setSchedulePreview(result.windows || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not preview this supplier schedule.")
    } finally {
      setSchedulePreviewLoading(false)
    }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Vendor profile</p>
            <CardTitle>{vendor.name}</CardTitle>
            <CardDescription>{vendor.code || vendor.type || "Supplier"} / {vendor.status || "active"}</CardDescription>
            <div className="mt-3 flex flex-wrap gap-1">
              <Badge variant={catalogSettings.enabled === true ? "success" : "outline"}>{catalogSettings.enabled === true ? "Included in catalog" : "Excluded from catalog"}</Badge>
              {marketplaceLoading ? <Badge variant="outline">Checking marketplace coverage</Badge> : <>
                <Badge variant="secondary">{numberLabel(marketplaceCoverage.productCount)} products</Badge>
                {marketplaceCoverage.shopifyLive > 0 && <Badge variant="success">Shopify {numberLabel(marketplaceCoverage.shopifyLive)} live</Badge>}
                {marketplaceCoverage.ebayLive > 0 && <Badge variant="info">eBay {numberLabel(marketplaceCoverage.ebayLive)} live</Badge>}
                {marketplaceCoverage.marketplaceLive === 0 && <Badge variant="outline">No live marketplace SKUs</Badge>}
              </>}
            </div>
          </div>
          <div className="flex flex-wrap items-end justify-end gap-2">
            {editing ? (
              <>
                <Button variant="outline" disabled={saving} onClick={() => { setEditing(false); setDraft({}) }}>Cancel</Button>
                <Button disabled={saving} onClick={save}>{saving ? <Loader2 className="size-4 animate-spin" /> : null}Save changes</Button>
              </>
            ) : <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline">Actions<ChevronDown className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setEditing(true)}>Edit supplier</DropdownMenuItem><DropdownMenuItem onClick={() => setCatalogRefreshOpen(true)}>Refresh catalog from stored records</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => setRetirementOpen(true)}>{vendor.retirement?.retiredAt ? "Review retirement" : "Retire supplier"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}
          </div>
        </CardHeader>
      </Card>

      <VendorCatalogRefreshDialog key={`catalog-${vendor.id}`} vendor={vendor} open={catalogRefreshOpen} onOpenChange={setCatalogRefreshOpen} />
      <SupplierRetirementDialog key={vendor.id} vendor={vendor} open={retirementOpen} onOpenChange={setRetirementOpen} onApplied={() => onSave(vendor.id, {})} />
      <SupplierDropshipConversionDialog key={`dropship-${vendor.id}`} vendor={vendor} open={dropshipConversionOpen} onOpenChange={setDropshipConversionOpen} />
      <Dialog open={supplierLocationOpen} onOpenChange={setSupplierLocationOpen}>
        <DialogContent className="flex max-h-[92dvh] w-[calc(100%-1rem)] max-w-[calc(100%-1rem)] flex-col overflow-hidden p-0 sm:!max-w-5xl">
          <DialogHeader className="shrink-0 border-b px-5 py-4"><DialogTitle>{supplierLocations.some((location) => location.id === supplierLocationDraft.id) ? "Edit supplier location" : "Add supplier location"}</DialogTitle><DialogDescription>Define the supplier's fulfillment location, inventory source, and operating rules. The location becomes sellable only after an exact feed or API identifier is mapped.</DialogDescription></DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto"><div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
            <div className="md:col-span-2 xl:col-span-3"><h3 className="text-sm font-semibold">Location identity</h3><p className="text-xs text-muted-foreground">Use the supplier's own name and stable warehouse code.</p></div>
            <Field label="Location name"><Input value={supplierLocationDraft.name} onChange={(event) => updateSupplierLocation("name", event.target.value)} placeholder="Harrisburg distribution center" /></Field>
            <Field label="Supplier location code"><Input value={supplierLocationDraft.code} onChange={(event) => updateSupplierLocation("code", event.target.value)} placeholder="HAR" /><p className="text-xs text-muted-foreground">A stable code used on orders and inventory records.</p></Field>
            <Field label="Status"><Select value={supplierLocationDraft.status} onValueChange={(next) => updateSupplierLocation("status", next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">Active</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent></Select></Field>
            <Field label="Fulfillment priority"><Input type="number" min="1" step="1" value={String(supplierLocationDraft.priority)} onChange={(event) => updateSupplierLocation("priority", Math.max(1, Number(event.target.value || 1)))} /><p className="text-xs text-muted-foreground">Lower numbers are preferred when routing becomes location-aware.</p></Field>
            <div className="md:col-span-2 xl:col-span-3 mt-2 border-t pt-4"><h3 className="text-sm font-semibold">Inventory and fulfillment</h3><p className="text-xs text-muted-foreground">Control whether stock is usable and whether this facility can ship directly to customers.</p></div>
            <div className="flex items-start justify-between gap-4 rounded-md border p-3"><div><Label>Use inventory</Label><p className="mt-1 text-xs text-muted-foreground">Allow mapped quantities to participate in supplier availability.</p></div><Switch checked={supplierLocationDraft.inventoryEnabled} onCheckedChange={(checked) => updateSupplierLocation("inventoryEnabled", checked)} /></div>
            <div className="flex items-start justify-between gap-4 rounded-md border p-3"><div><Label>Dropship location</Label><p className="mt-1 text-xs text-muted-foreground">This location can ship directly to customers.</p></div><Switch checked={supplierLocationDraft.dropshipEnabled} onCheckedChange={(checked) => updateSupplierLocation("dropshipEnabled", checked)} /></div>
            <Field label="Feed/API location identifiers"><Input value={(supplierLocationDraft.sourceLocationIds || []).join(" | ")} onChange={(event) => updateSupplierLocation("sourceLocationIds", event.target.value.split(/[|,\n]/).map((value) => value.trim()).filter(Boolean))} placeholder="warehouse_01 | east_dc" /><p className="text-xs text-muted-foreground">Exact identifiers from the supplier source. Multiple aliases are allowed.</p></Field>
            <Field label="Freshness limit (hours)"><Input type="number" min="1" step="1" value={String(supplierLocationDraft.freshnessHours)} onChange={(event) => updateSupplierLocation("freshnessHours", Math.max(1, Number(event.target.value || 1)))} /><p className="text-xs text-muted-foreground">Older location inventory can be held from channel availability.</p></Field>
            <Field label="Lead time (days)"><Input type="number" min="0" step="0.5" value={String(supplierLocationDraft.leadTimeDays)} onChange={(event) => updateSupplierLocation("leadTimeDays", Math.max(0, Number(event.target.value || 0)))} /></Field>
            <Field label="Order cutoff"><Input type="time" value={supplierLocationDraft.cutoffTime} onChange={(event) => updateSupplierLocation("cutoffTime", event.target.value)} /></Field>
            <div className="grid gap-3 rounded-md border p-3 md:col-span-2 xl:col-span-3"><div className="flex items-start justify-between gap-4"><div><Label>Location safety quantity</Label><p className="mt-1 text-xs text-muted-foreground">Override the vendor reserve only for inventory reported by this location.</p></div><Switch checked={supplierLocationDraft.safetyQtyEnabled} onCheckedChange={(checked) => updateSupplierLocation("safetyQtyEnabled", checked)} /></div>{supplierLocationDraft.safetyQtyEnabled && <Input className="max-w-48" aria-label="Location safety quantity" type="number" min="0" step="1" value={String(supplierLocationDraft.safetyQty ?? 0)} onChange={(event) => updateSupplierLocation("safetyQty", Math.max(0, Number(event.target.value || 0)))} />}</div>
            <div className="md:col-span-2 xl:col-span-3 mt-2 border-t pt-4"><h3 className="text-sm font-semibold">Address and notes</h3><p className="text-xs text-muted-foreground">Used for source identification, routing context, and vendor operations.</p></div>
            <Field label="Address line 1"><Input value={String(supplierLocationDraft.address?.line1 || "")} onChange={(event) => updateSupplierLocation("address.line1", event.target.value)} /></Field>
            <Field label="Address line 2"><Input value={String(supplierLocationDraft.address?.line2 || "")} onChange={(event) => updateSupplierLocation("address.line2", event.target.value)} /></Field>
            <Field label="City"><Input value={String(supplierLocationDraft.address?.city || "")} onChange={(event) => updateSupplierLocation("address.city", event.target.value)} /></Field>
            <Field label="State / region"><Input value={String(supplierLocationDraft.address?.state || "")} onChange={(event) => updateSupplierLocation("address.state", event.target.value)} /></Field>
            <Field label="Postal code"><Input value={String(supplierLocationDraft.address?.postalCode || "")} onChange={(event) => updateSupplierLocation("address.postalCode", event.target.value)} /></Field>
            <Field label="Country"><Input maxLength={2} value={String(supplierLocationDraft.address?.country || "US")} onChange={(event) => updateSupplierLocation("address.country", event.target.value.toUpperCase())} /></Field>
            <Field label="Timezone"><Input value={supplierLocationDraft.timezone} onChange={(event) => updateSupplierLocation("timezone", event.target.value)} placeholder="America/New_York" /></Field>
            <Field label="Notes"><Textarea value={supplierLocationDraft.notes || ""} onChange={(event) => updateSupplierLocation("notes", event.target.value)} placeholder="Supplier routing or fulfillment notes" /></Field>
          </div></div>
          <DialogFooter className="shrink-0 border-t bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><Button type="button" variant="outline" onClick={() => setSupplierLocationOpen(false)}>Cancel</Button><Button type="button" onClick={stageSupplierLocation}><Save className="size-4" /> Save location</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {vendor.retirement?.retiredAt && <div role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"><strong>Supplier retired</strong><p className="break-words">{vendor.retirement.reason}</p><p className="text-muted-foreground">{new Date(vendor.retirement.retiredAt).toLocaleString()}</p><a className="underline" href="/jobs">Review retirement job and channel follow-up</a></div>}
      <Tabs defaultValue="summary">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="contact">Contact</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
          <TabsTrigger value="inventory">Inventory</TabsTrigger>
          <TabsTrigger value="po-settings">PO Settings</TabsTrigger>
          <TabsTrigger value="data-feed">Catalog & data</TabsTrigger>
          <TabsTrigger value="receiving">Receiving</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="settings">
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Vendor settings</CardTitle>
                <CardDescription>Authoritative controls for whether this supplier participates in catalog workflows and how its source data is handled. Use Edit above, then Save changes.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <Field label="Vendor status">
                  <Select disabled={!editing} value={String(draft.status ?? vendor.status ?? "active").toLowerCase() === "active" ? "active" : "inactive"} onValueChange={(next) => update("status", next)}>
                    <SelectTrigger aria-label="Vendor status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">Inactive vendors remain available for review but are excluded from active catalog and workflow participation.</p>
                </Field>
                <ToggleField label="Include supplier in catalog" checked={Boolean(draft["catalogSettings.enabled"] ?? (catalogSettings.enabled === true))} disabled={!editing} onCheckedChange={(next) => update("catalogSettings.enabled", next)} />
                <Field label="Source / feed codes">
                  <Input disabled={!editing} value={catalogSourceCodes} onChange={(event) => update("catalogSettings.sourceCodes", event.target.value.split(/[|,\n]/).map((entry) => entry.trim()).filter(Boolean))} placeholder="TRV | USS" />
                  <p className="text-xs text-muted-foreground">Stable codes from incoming feeds are mapped to this supplier. Brands are not used as supplier identities.</p>
                </Field>
                <Field label="Catalog participation note">
                  <Textarea disabled={!editing} value={String(draft["catalogSettings.note"] ?? catalogSettings.note ?? "")} onChange={(event) => update("catalogSettings.note", event.target.value)} placeholder="Explain why this supplier is included or excluded" />
                </Field>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Feed precedence</CardTitle>
                <CardDescription>Choose whether this supplier's direct feed overrides matching records from the universal DataWarehouse import.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <ToggleField label="Prefer direct vendor feed" checked={Boolean(draft["sourcePriority.directFeedPriorityEnabled"] ?? sourcePriority.directFeedPriorityEnabled)} disabled={!editing} onCheckedChange={(next) => update("sourcePriority.directFeedPriorityEnabled", next)} />
                <Field label="Priority note"><Input disabled={!editing} value={String(draft["sourcePriority.note"] ?? sourcePriority.note ?? "")} onChange={(event) => update("sourcePriority.note", event.target.value)} placeholder="Optional instruction for data operations" /></Field>
              </CardContent>
            </Card>
            <VendorFeedScheduleManager vendors={[vendor]} vendor={vendor} onSaveVendorLocations={async (locations) => { await onSave(vendor.id, { supplierLocations: locations }) }} />
          </div>
        </TabsContent>
        <TabsContent value="summary" className="grid gap-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="Catalog products" value={marketplaceLoading ? "Loading" : numberLabel(marketplaceCoverage.productCount)} icon={Boxes} />
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
              <CardDescription>Supplier selling units and pricing.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Detail label="Cost basis" value={String(pricingRules.costBasis || "standard")} />
              <Detail label="Min allowed price" value={String(pricingRules.enforceMinimumAllowedPrice ?? true)} />
              <div className="grid gap-2 md:col-span-2 xl:col-span-2">
                <div><Label>Allowed selling units</Label><p className="mt-1 text-xs text-muted-foreground">Choose every customer selling unit this supplier permits. Source pack size is the largest valid UOM quantity, minimum quantity, or quantity increment.</p></div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex items-start gap-3 rounded-md border bg-muted/20 p-3">
                    <Checkbox disabled={!editing} checked={allowIndividualUnits} onCheckedChange={(checked) => updateSellingUnitPermission("individual", checked === true)} />
                    <span><span className="block text-sm font-medium">Individual Each</span><span className="mt-1 block text-xs text-muted-foreground">Allows opening a supplier pack and selling one piece.</span></span>
                  </label>
                  <label className="flex items-start gap-3 rounded-md border bg-muted/20 p-3">
                    <Checkbox disabled={!editing} checked={allowSupplierUnit} onCheckedChange={(checked) => updateSellingUnitPermission("supplier", checked === true)} />
                    <span><span className="block text-sm font-medium">Supplier-defined unit</span><span className="mt-1 block text-xs text-muted-foreground">Each when all source quantities are 1; otherwise one complete pack or case.</span></span>
                  </label>
                </div>
                {sellingUnitMode === "inherit" && <p className="text-xs text-amber-700 dark:text-amber-300">Currently inherited from the supplier's legacy variation rule. Changing either checkbox saves an explicit vendor policy.</p>}
              </div>
              <Detail label="Walmart selling unit" value="Individual only" />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="inventory">
          <Card>
            <CardHeader className="border-b">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">Inventory rules</CardTitle><CardDescription className="mt-1">Vendor policies override channel defaults only when their switch is enabled. SKU bypass rules remain the final exception.</CardDescription></div><Badge variant={vendorSafetyQtyEnabled ? "success" : "outline"}>{vendorSafetyQtyEnabled ? `Safety reserve active: ${numberLabel(vendorSafetyQty)}` : "Using channel safety"}</Badge></div>
            </CardHeader>
            <CardContent className="grid gap-4 p-4 lg:grid-cols-2">
              <section className="grid content-start gap-4 rounded-md border bg-muted/10 p-4">
                <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">Vendor safety quantity</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Reserve this many supplier units before publishing inventory to any channel.</p></div><Switch aria-label="Enable vendor safety quantity" checked={vendorSafetyQtyEnabled} disabled={!editing} onCheckedChange={(checked) => { update("inventoryRules.safetyQtyEnabled", checked); if (checked && (vendorSafetyQty === null || vendorSafetyQty === undefined || vendorSafetyQty === "")) update("inventoryRules.safetyQty", 0) }} /></div>
                <Separator />
                <Field label="Safety quantity"><Input disabled={!editing || !vendorSafetyQtyEnabled} type="number" min="0" step="1" placeholder="Enter reserve" value={String(vendorSafetyQty ?? "")} onChange={(event) => update("inventoryRules.safetyQty", event.target.value === "" ? null : Number(event.target.value))} /><p className="text-xs text-muted-foreground">{vendorSafetyQtyEnabled ? `Active vendor override. Channels will reserve ${numberLabel(vendorSafetyQty)} unit${Number(vendorSafetyQty) === 1 ? "" : "s"}.` : "Off. Each channel's own safety quantity remains in control."}</p></Field>
              </section>
              <section className="grid content-start gap-4 rounded-md border bg-muted/10 p-4">
                <div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-semibold">Replenishable inventory</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Keep eligible SKUs sellable at a controlled target without changing warehouse stock.</p></div><Switch aria-label="Enable vendor replenishable inventory" checked={Boolean(draft["inventoryRules.replenishableEnabled"] !== undefined ? draft["inventoryRules.replenishableEnabled"] : inventoryRules.replenishableEnabled)} disabled={!editing} onCheckedChange={(checked) => update("inventoryRules.replenishableEnabled", checked)} /></div>
                <Separator />
                <Field label="Vendor replenishable quantity"><Input disabled={!editing} type="number" min="0" step="1" placeholder="Use channel default" value={String(draft["inventoryRules.replenishableQty"] !== undefined ? draft["inventoryRules.replenishableQty"] ?? "" : inventoryRules.replenishableQty ?? "")} onChange={(event) => update("inventoryRules.replenishableQty", event.target.value === "" ? 0 : Number(event.target.value))} /><p className="text-xs text-muted-foreground">Use 0 to fall back to each channel's replenishable default.</p></Field>
              </section>
              <section className="grid gap-3 lg:col-span-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><h3 className="text-sm font-semibold">Supplier locations</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Track the vendor's real fulfillment locations without treating supplier availability as physical DataPlus stock.</p></div>
                  <Button type="button" size="sm" variant="outline" disabled={!editing} onClick={() => openSupplierLocation()}><Plus className="size-4" /> Add location</Button>
                </div>
                {supplierLocations.length ? <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader><TableRow><TableHead>Location</TableHead><TableHead>Inventory mapping</TableHead><TableHead>Fulfillment</TableHead><TableHead>Safety</TableHead><TableHead className="w-28 text-right">Action</TableHead></TableRow></TableHeader>
                    <TableBody>{[...supplierLocations].sort((left, right) => Number(left.priority || 0) - Number(right.priority || 0)).map((location) => {
                      const managed = managedSupplierWarehouses.find((warehouse) => String(warehouse.vendorLocationId || "") === location.id)
                      const mapped = (location.sourceLocationIds || []).length > 0
                      const address = [location.address?.city, location.address?.state, location.address?.country].filter(Boolean).join(", ")
                      return <TableRow key={location.id}>
                        <TableCell className="min-w-52"><div className="flex flex-wrap items-center gap-2"><span className="font-medium">{location.name}</span><Badge variant={location.status === "active" ? "success" : "secondary"}>{location.status}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{location.code}{address ? ` · ${address}` : ""} · priority {numberLabel(location.priority)}</p></TableCell>
                        <TableCell className="min-w-48"><Badge variant={mapped ? "success" : "warning"}>{mapped ? "Mapped" : "Mapping needed"}</Badge><p className="mt-1 max-w-72 break-words text-xs text-muted-foreground">{mapped ? location.sourceLocationIds.join(", ") : "Add the location identifier supplied by the feed or API."}</p>{managed && <p className="mt-1 text-xs text-muted-foreground">Virtual location {String(managed.code || "created")}</p>}</TableCell>
                        <TableCell className="min-w-40"><p className="text-sm">{location.dropshipEnabled ? "Dropship enabled" : "Supplier availability"}</p><p className="text-xs text-muted-foreground">{numberLabel(location.leadTimeDays)} day lead{location.cutoffTime ? ` · cutoff ${location.cutoffTime}` : ""}</p></TableCell>
                        <TableCell><p className="text-sm">{location.safetyQtyEnabled ? numberLabel(location.safetyQty) : "Vendor default"}</p><p className="text-xs text-muted-foreground">Fresh after {numberLabel(location.freshnessHours)}h</p></TableCell>
                        <TableCell className="text-right"><DropdownMenu><DropdownMenuTrigger asChild><Button type="button" size="icon-sm" variant="ghost" disabled={!editing}><MoreHorizontal className="size-4" /><span className="sr-only">Location actions</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => openSupplierLocation(location)}><Pencil className="size-4" /> Edit location</DropdownMenuItem><DropdownMenuItem onClick={() => setSupplierLocationStatus(location, location.status === "active" ? "inactive" : "active")}>{location.status === "active" ? <Ban className="size-4" /> : <CheckCircle2 className="size-4" />}{location.status === "active" ? "Deactivate" : "Activate"}</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell>
                      </TableRow>
                    })}</TableBody>
                  </Table>
                </div> : <div className="rounded-md border border-dashed p-5 text-center"><Warehouse className="mx-auto size-5 text-muted-foreground" /><p className="mt-2 text-sm font-medium">No supplier locations configured</p><p className="mt-1 text-xs text-muted-foreground">Vendor inventory continues to use its current aggregate source.</p></div>}
                {draft.supplierLocations !== undefined && <Alert className="border-blue-500/30 bg-blue-500/5"><Save className="size-4" /><AlertTitle>Locations staged</AlertTitle><AlertDescription>Use Save changes at the top of the vendor profile to create or update the virtual supplier locations.</AlertDescription></Alert>}
              </section>
              <div className="lg:col-span-2"><Alert><Warehouse className="size-4" /><AlertTitle>Inventory source</AlertTitle><AlertDescription>Vendor availability remains supplier-feed inventory. These policies never add units to the Staten Island physical warehouse.</AlertDescription></Alert></div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="po-settings">
          <div className="grid gap-4">
            <Card>
              <CardHeader><CardTitle className="text-base">Existing open demand</CardTitle><CardDescription>After enabling Dropship all new orders, preview and convert eligible lines already collected in pooled draft POs.</CardDescription></CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-sm text-muted-foreground">Submitted, acknowledged, received, canceled, and incomplete-address lines remain untouched for review.</p><Button type="button" variant="outline" disabled={editing || purchaseOrderRules.dropShipAllOrders !== true || purchaseOrderRules.dropShipEnabled !== true} onClick={() => setDropshipConversionOpen(true)}><Truck className="size-4" /> Preview conversion</Button></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Purchase order settings</CardTitle><CardDescription>Record whether the supplier can dropship, then independently choose whether every new order should use dropship routing.</CardDescription></CardHeader>
              <CardContent className="grid gap-4">
                <ToggleField label="Supplier can dropship" description="Allows buyers to move selected pooled PO lines to direct-to-customer dropship POs. This setting does not change future-order routing." checked={supplierDropshipSupported} disabled={!editing} onCheckedChange={(next) => { update("purchaseOrderRules.dropShipEnabled", next); if (!next) { update("purchaseOrderRules.dropShipAllOrders", false); update("purchaseOrderRules.fulfillmentMode", "pooled") } }} />
                <ToggleField label="Dropship all new orders" description="When enabled, every new customer order for this supplier creates a direct-to-customer PO instead of collecting in a draft PO." checked={supplierDropshipAllOrders} disabled={!editing || !supplierDropshipSupported} onCheckedChange={(next) => { update("purchaseOrderRules.dropShipAllOrders", next); update("purchaseOrderRules.fulfillmentMode", next ? "dropship_per_order" : "pooled") }} />
                {supplierDropshipAllOrders ? <Alert className="border-blue-500/30 bg-blue-500/5"><Truck className="size-4" /><AlertTitle>All new orders will dropship</AlertTitle><AlertDescription>Each paid order receives its own direct-to-customer PO. Turn this off to resume collecting future demand in supplier draft POs.</AlertDescription></Alert> : null}
                <ToggleField label="Auto-create draft POs" checked={Boolean(draft["purchaseOrderRules.autoCreateDrafts"] ?? purchaseOrderRules.autoCreateDrafts)} disabled={!editing} onCheckedChange={(next) => update("purchaseOrderRules.autoCreateDrafts", next)} />
                <ToggleField label="Pool demand until supplier cutoff" description="Combine eligible order lines for this supplier into one draft PO per receiving warehouse." checked={Boolean(draft["purchaseOrderRules.poolUntilCutoff"] ?? (purchaseOrderRules.poolUntilCutoff ?? true))} disabled={!editing || supplierDropshipAllOrders} onCheckedChange={(next) => update("purchaseOrderRules.poolUntilCutoff", next)} />
                <ToggleField label="Use weekly delivery calendar" description="Set the real order cutoff and expected delivery weekday for suppliers that ship on selected days." checked={weeklyScheduleEnabled} disabled={!editing || (draft["purchaseOrderRules.poolUntilCutoff"] ?? purchaseOrderRules.poolUntilCutoff ?? true) === false} onCheckedChange={setWeeklyScheduleEnabled} />
                {weeklyScheduleEnabled && <div className="grid gap-3 rounded-lg border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium">Cutoff and delivery windows</p><p className="text-xs text-muted-foreground">Orders collect into the current draft until cutoff. The expected delivery date is saved on the PO.</p></div><Button type="button" size="sm" variant="outline" disabled={!editing} onClick={addDeliveryScheduleRow}><CalendarDays className="size-4" /> Add window</Button></div>
                  {deliverySchedule.map((row) => <div key={row.id} className="grid gap-3 rounded-md border bg-background p-3 md:grid-cols-[1fr_9rem_1fr_auto] md:items-end">
                    <Field label="Order cutoff day"><Select disabled={!editing || !row.enabled} value={String(row.cutoffDay)} onValueChange={(next) => updateDeliveryScheduleRow(row.id, "cutoffDay", Number(next))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PURCHASE_WEEKDAYS.map((day, index) => <SelectItem key={day} value={String(index)}>{day}</SelectItem>)}</SelectContent></Select></Field>
                    <Field label="Cutoff time"><Input disabled={!editing || !row.enabled} type="time" value={row.cutoffTime} onChange={(event) => updateDeliveryScheduleRow(row.id, "cutoffTime", event.target.value)} /></Field>
                    <Field label="Expected delivery day"><Select disabled={!editing || !row.enabled} value={String(row.deliveryDay)} onValueChange={(next) => updateDeliveryScheduleRow(row.id, "deliveryDay", Number(next))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{PURCHASE_WEEKDAYS.map((day, index) => <SelectItem key={day} value={String(index)}>{day}</SelectItem>)}</SelectContent></Select></Field>
                    <div className="flex items-center justify-end gap-2 pb-0.5"><Switch aria-label={`${PURCHASE_WEEKDAYS[row.cutoffDay]} delivery window`} disabled={!editing} checked={row.enabled} onCheckedChange={(next) => updateDeliveryScheduleRow(row.id, "enabled", next)} /><Button type="button" size="icon" variant="ghost" disabled={!editing} title="Remove delivery window" onClick={() => update("purchaseOrderRules.deliverySchedule", deliverySchedule.filter((entry) => entry.id !== row.id))}><Trash2 className="size-4" /></Button></div>
                  </div>)}
                  {!deliverySchedule.length && <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">Add the supplier's first cutoff and delivery window.</p>}
                </div>}
                <Field label={weeklyScheduleEnabled ? "Fallback daily cutoff" : "Daily supplier cutoff"}><Input disabled={!editing || weeklyScheduleEnabled || (draft["purchaseOrderRules.poolUntilCutoff"] ?? purchaseOrderRules.poolUntilCutoff ?? true) === false} type="time" value={String(draft["purchaseOrderRules.cutoffTime"] ?? purchaseOrderRules.cutoffTime ?? "15:00")} onChange={(event) => update("purchaseOrderRules.cutoffTime", event.target.value)} /><p className="mt-1 text-xs text-muted-foreground">{weeklyScheduleEnabled ? "Used only if the weekly delivery calendar is disabled or unavailable." : "Orders received after this time roll into the next eligible business-day pool."}</p></Field>
                <Field label="Cutoff timezone"><Select disabled={!editing || (draft["purchaseOrderRules.poolUntilCutoff"] ?? purchaseOrderRules.poolUntilCutoff ?? true) === false} value={String(draft["purchaseOrderRules.cutoffTimezone"] ?? purchaseOrderRules.cutoffTimezone ?? "America/New_York")} onValueChange={(next) => update("purchaseOrderRules.cutoffTimezone", next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="America/New_York">Eastern</SelectItem><SelectItem value="America/Chicago">Central</SelectItem><SelectItem value="America/Denver">Mountain</SelectItem><SelectItem value="America/Los_Angeles">Pacific</SelectItem><SelectItem value="UTC">UTC</SelectItem></SelectContent></Select></Field>
                <div className="grid gap-3 rounded-lg border bg-muted/20 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium">Supplier closures and holidays</p><p className="text-xs text-muted-foreground">Cutoffs and delivery dates automatically move past enabled blackout dates.</p></div><Button type="button" size="sm" variant="outline" disabled={!editing} onClick={addScheduleException}><CalendarDays className="size-4" /> Add closure</Button></div>
                  {scheduleExceptions.map((row) => <div key={row.id} className="grid gap-3 rounded-md border bg-background p-3 md:grid-cols-[11rem_1fr_auto] md:items-end">
                    <Field label="Closed date"><Input disabled={!editing || !row.enabled} type="date" value={row.date} onChange={(event) => updateScheduleException(row.id, "date", event.target.value)} /></Field>
                    <Field label="Reason"><Input disabled={!editing || !row.enabled} value={row.label} onChange={(event) => updateScheduleException(row.id, "label", event.target.value)} placeholder="Holiday or supplier closure" /></Field>
                    <div className="flex items-center justify-end gap-2 pb-0.5"><Switch aria-label={`${row.label} closure`} disabled={!editing} checked={row.enabled} onCheckedChange={(next) => updateScheduleException(row.id, "enabled", next)} /><Button type="button" size="icon" variant="ghost" disabled={!editing} title="Remove closure" onClick={() => update("purchaseOrderRules.scheduleExceptions", scheduleExceptions.filter((entry) => entry.id !== row.id))}><Trash2 className="size-4" /></Button></div>
                  </div>)}
                  {!scheduleExceptions.length && <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">No supplier closures are configured.</p>}
                </div>
                <div className="grid gap-3 rounded-lg border bg-muted/20 p-3">
                  <ToggleField label="Use temporary schedule override" description="Temporarily replace the regular calendar for a special cutoff or delivery date. The override is ignored after its cutoff passes." checked={temporaryScheduleOverride.enabled} disabled={!editing} onCheckedChange={(next) => updateTemporaryScheduleOverride("enabled", next)} />
                  {temporaryScheduleOverride.enabled && <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <Field label="Override cutoff date"><Input disabled={!editing} type="date" value={temporaryScheduleOverride.cutoffDate} onChange={(event) => updateTemporaryScheduleOverride("cutoffDate", event.target.value)} /></Field>
                    <Field label="Override cutoff time"><Input disabled={!editing} type="time" value={temporaryScheduleOverride.cutoffTime} onChange={(event) => updateTemporaryScheduleOverride("cutoffTime", event.target.value)} /></Field>
                    <Field label="Expected delivery date"><Input disabled={!editing} type="date" value={temporaryScheduleOverride.deliveryDate} onChange={(event) => updateTemporaryScheduleOverride("deliveryDate", event.target.value)} /></Field>
                    <Field label="Reason"><Input disabled={!editing} value={temporaryScheduleOverride.label} onChange={(event) => updateTemporaryScheduleOverride("label", event.target.value)} placeholder="Holiday week schedule" /></Field>
                  </div>}
                </div>
                <ToggleField label="Buyer cutoff alerts" description="Show approaching cutoffs and Ready to Send actions in Purchasing." checked={Boolean(draft["purchaseOrderRules.cutoffAlertsEnabled"] ?? (purchaseOrderRules.cutoffAlertsEnabled ?? true))} disabled={!editing} onCheckedChange={(next) => update("purchaseOrderRules.cutoffAlertsEnabled", next)} />
                <Field label="Alert before cutoff (minutes)"><Input disabled={!editing || Boolean(draft["purchaseOrderRules.cutoffAlertsEnabled"] ?? (purchaseOrderRules.cutoffAlertsEnabled ?? true)) === false} type="number" min="0" step="15" value={String(draft["purchaseOrderRules.cutoffAlertLeadMinutes"] ?? purchaseOrderRules.cutoffAlertLeadMinutes ?? 120)} onChange={(event) => update("purchaseOrderRules.cutoffAlertLeadMinutes", Number(event.target.value || 0))} /></Field>
                <div className="grid gap-3 rounded-lg border bg-background p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium">Schedule preview</p><p className="text-xs text-muted-foreground">Check the next cutoff and expected delivery windows using the current unsaved settings.</p></div><Button type="button" size="sm" variant="outline" disabled={schedulePreviewLoading} onClick={() => void previewPurchaseSchedule()}>{schedulePreviewLoading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Preview dates</Button></div>
                  {schedulePreview.length > 0 && <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{schedulePreview.map((window, index) => <div key={`${String(window.poolDate)}-${String(window.cutoffTime)}-${index}`} className="rounded-md border bg-muted/20 p-3"><p className="text-xs font-semibold uppercase text-muted-foreground">{String(window.scheduleLabel || window.scheduleMode || "Supplier window")}</p><p className="mt-1 text-sm font-medium">Cutoff {purchaseScheduleDateLabel(window.poolDate)} at {purchaseScheduleTimeLabel(window.cutoffTime)}</p><p className="text-xs text-muted-foreground">Expected {purchaseScheduleDateLabel(window.expectedDeliveryDate)}</p></div>)}</div>}
                </div>
                <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
                  <div className="sm:col-span-2"><p className="text-sm font-medium">Dropship fees</p><p className="text-xs text-muted-foreground">Applied to dropship POs and current linked-order P&amp;L. Closed orders keep their historical values.</p></div>
                  <Field label="Fee percentage"><Input disabled={!editing} type="number" min="0" max="100" step="0.01" value={String(draft["purchaseOrderRules.dropShipFeePercent"] ?? purchaseOrderRules.dropShipFeePercent ?? 0)} onChange={(event) => update("purchaseOrderRules.dropShipFeePercent", Math.max(0, Math.min(100, Number(event.target.value || 0))))} /><p className="mt-1 text-xs text-muted-foreground">Percentage of merchandise cost, such as 4% for Do it Best.</p></Field>
                  <Field label="Fixed fee per PO"><Input disabled={!editing} type="number" min="0" step="0.01" value={String(draft["purchaseOrderRules.dropShipFeeFixedAmount"] ?? purchaseOrderRules.dropShipFeeFixedAmount ?? 0)} onChange={(event) => update("purchaseOrderRules.dropShipFeeFixedAmount", Math.max(0, Number(event.target.value || 0)))} /><p className="mt-1 text-xs text-muted-foreground">Added once to each dropship PO.</p></Field>
                </div>
                <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
                  <div className="sm:col-span-2"><ToggleField label="Enable supplier PO submission" description="Shows Submit to supplier on this vendor's purchase orders. Leave disabled when buyers place orders outside DataPlus." checked={Boolean(draft["submissionSettings.enabled"] ?? submissionSettings.enabled)} disabled={!editing} onCheckedChange={(next) => update("submissionSettings.enabled", next)} /></div>
                  <div className="sm:col-span-2"><ToggleField label="Supplier provides inbound tracking" description="Turn this off for suppliers such as True Value. Placed POs move directly to Incoming and use the expected delivery date without waiting for tracking." checked={Boolean(draft["submissionSettings.inboundTrackingExpected"] ?? (submissionSettings.inboundTrackingExpected ?? true))} disabled={!editing} onCheckedChange={(next) => update("submissionSettings.inboundTrackingExpected", next)} /></div>
                  <Field label="Preferred method"><Select disabled={!editing || Boolean(draft["submissionSettings.enabled"] ?? submissionSettings.enabled) === false} value={String(draft["submissionSettings.preferredMethod"] ?? submissionSettings.preferredMethod ?? "email")} onValueChange={(next) => update("submissionSettings.preferredMethod", next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="email">Email</SelectItem><SelectItem value="api">API</SelectItem><SelectItem value="ftp">FTP</SelectItem><SelectItem value="manual">Manual record</SelectItem></SelectContent></Select></Field>
                  <Field label="Submission email"><Input disabled={!editing || Boolean(draft["submissionSettings.enabled"] ?? submissionSettings.enabled) === false} type="email" value={String(draft["submissionSettings.emailTo"] ?? submissionSettings.emailTo ?? vendor.email ?? "")} onChange={(event) => update("submissionSettings.emailTo", event.target.value)} placeholder="purchasing@supplier.com" /></Field>
                  <ToggleField label="Allow email submission" checked={Boolean(draft["submissionSettings.emailEnabled"] ?? (submissionSettings.emailEnabled ?? true))} disabled={!editing || Boolean(draft["submissionSettings.enabled"] ?? submissionSettings.enabled) === false} onCheckedChange={(next) => update("submissionSettings.emailEnabled", next)} />
                  <ToggleField label="Allow API submission" checked={Boolean(draft["submissionSettings.apiEnabled"] ?? submissionSettings.apiEnabled)} disabled={!editing || Boolean(draft["submissionSettings.enabled"] ?? submissionSettings.enabled) === false} onCheckedChange={(next) => update("submissionSettings.apiEnabled", next)} />
                  <ToggleField label="Allow FTP submission" checked={Boolean(draft["submissionSettings.ftpEnabled"] ?? submissionSettings.ftpEnabled)} disabled={!editing || Boolean(draft["submissionSettings.enabled"] ?? submissionSettings.enabled) === false} onCheckedChange={(next) => update("submissionSettings.ftpEnabled", next)} />
                </div>
                <ToggleField label="Require buyer approval" checked={Boolean(draft["purchaseOrderRules.requireBuyerApproval"] ?? (purchaseOrderRules.requireBuyerApproval ?? true))} disabled={!editing} onCheckedChange={(next) => update("purchaseOrderRules.requireBuyerApproval", next)} />
                <Field label="Approval threshold"><Input disabled={!editing} type="number" min="0" value={String(draft["purchaseOrderRules.approvalThreshold"] ?? purchaseOrderRules.approvalThreshold ?? 0)} onChange={(event) => update("purchaseOrderRules.approvalThreshold", Number(event.target.value || 0))} /><p className="mt-1 text-xs text-muted-foreground">0 means every supplier PO requires buyer approval.</p></Field>
                <Field label="Open PO budget"><Input disabled={!editing} type="number" min="0" value={String(draft["purchaseOrderRules.budgetLimit"] ?? purchaseOrderRules.budgetLimit ?? 0)} onChange={(event) => update("purchaseOrderRules.budgetLimit", Number(event.target.value || 0))} /><p className="mt-1 text-xs text-muted-foreground">0 disables the supplier commitment limit.</p></Field>
                <ToggleField label="Send overdue PO reminders" checked={Boolean(draft["purchaseOrderRules.overdueReminderEnabled"] ?? purchaseOrderRules.overdueReminderEnabled)} disabled={!editing} onCheckedChange={(next) => update("purchaseOrderRules.overdueReminderEnabled", next)} />
                <Field label="Reminder subject"><Input disabled={!editing} value={String(draft["purchaseOrderRules.overdueReminderSubject"] ?? purchaseOrderRules.overdueReminderSubject ?? "Action needed: overdue PO {{poNumber}}") } onChange={(event) => update("purchaseOrderRules.overdueReminderSubject", event.target.value)} /></Field>
                <Field label="Reminder template"><Textarea disabled={!editing} value={String(draft["purchaseOrderRules.overdueReminderBody"] ?? purchaseOrderRules.overdueReminderBody ?? "")} onChange={(event) => update("purchaseOrderRules.overdueReminderBody", event.target.value)} placeholder="Use {{poNumber}}, {{supplier}}, and {{expectedAt}}" /></Field>
                <Field label="Follow-up every (days)"><Input disabled={!editing} type="number" min="1" value={String(draft["purchaseOrderRules.overdueReminderFollowUpDays"] ?? purchaseOrderRules.overdueReminderFollowUpDays ?? 3)} onChange={(event) => update("purchaseOrderRules.overdueReminderFollowUpDays", Number(event.target.value || 3))} /></Field>
                <Field label="Maximum follow-ups"><Input disabled={!editing} type="number" min="0" value={String(draft["purchaseOrderRules.overdueReminderMaxFollowUps"] ?? purchaseOrderRules.overdueReminderMaxFollowUps ?? 2)} onChange={(event) => update("purchaseOrderRules.overdueReminderMaxFollowUps", Number(event.target.value || 0))} /></Field>
                <Field label="Default receiving warehouse"><Select disabled={!editing} value={String(draft["purchaseOrderRules.defaultWarehouseId"] ?? purchaseOrderRules.defaultWarehouseId ?? "order-destination")} onValueChange={(next) => update("purchaseOrderRules.defaultWarehouseId", next === "order-destination" ? "" : next)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="order-destination">Use order destination</SelectItem>{warehouses.map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{String(warehouse.name || warehouse.id)}</SelectItem>)}</SelectContent></Select></Field>
                <Field label="Automation note"><Input disabled={!editing} value={String(draft["purchaseOrderRules.note"] ?? purchaseOrderRules.note ?? "")} onChange={(event) => update("purchaseOrderRules.note", event.target.value)} placeholder="Optional buyer instruction" /></Field>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="data-feed">
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Catalog participation</CardTitle>
                <CardDescription>Only included supplier profiles load into the fast managed catalog. Disabled supplier records remain in the database and can be reviewed from their profile.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2 grid gap-3 sm:grid-cols-4">
                  <Detail label="Catalog SKUs" value={marketplaceLoading ? "Checking" : numberLabel(marketplaceCoverage.productCount)} />
                  <Detail label="Active catalog SKUs" value={marketplaceLoading ? "Checking" : numberLabel(marketplaceCoverage.activeProductCount)} />
                  <Detail label="Shopify live" value={marketplaceLoading ? "Checking" : numberLabel(marketplaceCoverage.shopifyLive)} />
                  <Detail label="eBay live" value={marketplaceLoading ? "Checking" : numberLabel(marketplaceCoverage.ebayLive)} />
                </div>
                <Detail label="Catalog participation" value={catalogSettings.enabled === true ? "Included" : "Excluded"} />
                <Detail label="Source / feed codes" value={catalogSourceCodes || "Not configured"} />
                <Detail label="Direct feed precedence" value={sourcePriority.directFeedPriorityEnabled ? "Preferred" : "Universal feed"} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">Source precedence</CardTitle><CardDescription>When this supplier has a direct feed, decide whether it overrides the universal DataWarehouse import for this supplier's records.</CardDescription></CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <Field label="When enabled"><Input disabled value="Direct vendor FTP takes precedence over DataWarehouse" /></Field>
                <Field label="Priority note"><Input disabled value={String(sourcePriority.note || "Not configured")} /></Field>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="receiving">
          <div className="grid gap-4">
            <Card>
              <CardHeader className="border-b">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><CardTitle className="text-base">Packing slip OCR template</CardTitle><CardDescription>Map this supplier's fixed packing-slip columns once. Receiving audits use local OCR first, without AI usage.</CardDescription></div>
                  <Badge variant={receivingDocumentTemplate.enabled !== false ? "success" : "outline"}>{receivingDocumentTemplate.enabled !== false ? "Local OCR enabled" : "Disabled"}</Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 p-4">
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <ToggleField label="Use local OCR template" checked={receivingDocumentTemplate.enabled !== false} disabled={!editing} onCheckedChange={(next) => updateReceivingTemplate("enabled", next)} />
                  <Field label="Template name"><Input disabled={!editing} value={String(receivingDocumentTemplate.name || "Packing slip columns")} onChange={(event) => updateReceivingTemplate("name", event.target.value)} /></Field>
                  <Field label="Minimum OCR confidence"><Input disabled={!editing} type="number" min="0" max="100" value={String(receivingDocumentTemplate.minimumConfidence ?? 45)} onChange={(event) => updateReceivingTemplate("minimumConfidence", Number(event.target.value || 0))} /></Field>
                  <ToggleField label="Allow David fallback" checked={receivingDocumentTemplate.aiFallbackEnabled !== false} disabled={!editing} onCheckedChange={(next) => updateReceivingTemplate("aiFallbackEnabled", next)} />
                  <Field label="Document markers"><Input disabled={!editing} className="md:col-span-2" value={(receivingDocumentTemplate.documentMarkers || []).join(" | ")} onChange={(event) => updateReceivingTemplate("documentMarkers", event.target.value.split(/[|\n]/).map((value) => value.trim()).filter(Boolean))} placeholder="Supplier name | document title" /><p className="text-xs text-muted-foreground">Text expected on this supplier's document, separated by |.</p></Field>
                  <Field label="OCR page layout"><Select disabled={!editing} value={String(receivingDocumentTemplate.pageSegmentationMode || 6)} onValueChange={(value) => updateReceivingTemplate("pageSegmentationMode", Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="4">Variable columns</SelectItem><SelectItem value="6">Uniform table block</SelectItem><SelectItem value="11">Sparse text</SelectItem></SelectContent></Select></Field>
                </div>
                <div>
                  <h3 className="text-sm font-semibold">Column mapping</h3>
                  <p className="mt-1 text-xs text-muted-foreground">Percentages run from the left edge (0) to the right edge (100). They let the same mapping work across different camera resolutions.</p>
                </div>
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader><TableRow><TableHead>DataPlus field</TableHead><TableHead>Printed heading</TableHead><TableHead className="w-32">Starts at %</TableHead><TableHead className="w-32">Ends at %</TableHead></TableRow></TableHeader>
                    <TableBody>{receivingFieldRows.map(([field, label]) => {
                      const column = receivingColumns[field] || {}
                      return <TableRow key={field}><TableCell className="font-medium">{label}</TableCell><TableCell><Input disabled={!editing} value={String(column.label || "")} onChange={(event) => updateReceivingColumn(field, "label", event.target.value)} /></TableCell><TableCell><Input disabled={!editing} type="number" min="0" max="100" step="0.5" value={String(column.startPercent ?? 0)} onChange={(event) => updateReceivingColumn(field, "startPercent", Number(event.target.value || 0))} /></TableCell><TableCell><Input disabled={!editing} type="number" min="0" max="100" step="0.5" value={String(column.endPercent ?? 100)} onChange={(event) => updateReceivingColumn(field, "endPercent", Number(event.target.value || 0))} /></TableCell></TableRow>
                    })}</TableBody>
                  </Table>
                </div>
                <Alert><ScanSearch className="size-4" /><AlertTitle>Local first, AI only when requested</AlertTitle><AlertDescription>Uploaded photos stay attached to the audit. Tesseract reads the mapped columns locally. David is available only as a fallback for an unfamiliar layout or low-confidence extraction.</AlertDescription></Alert>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="categories">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Vendor category mappings</CardTitle>
              <CardDescription>Heavy mapping data loads only when opened in the mapping workspace.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild variant="outline"><a href="/vendor-category-mappings">Open mapping workspace</a></Button>
              <Button asChild variant="outline"><a href="/categories">Main categories</a></Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
