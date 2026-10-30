import { Alert,AlertDescription,AlertTitle } from "@/components/ui/alert"
import { AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogFooter,AlertDialogHeader,AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card,CardContent,CardDescription,CardFooter,CardHeader,CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Empty,EmptyDescription,EmptyHeader,EmptyMedia,EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { cn } from "@/lib/utils"
import { createColumnHelper,flexRender,getCoreRowModel,getFilteredRowModel,useReactTable } from "@tanstack/react-table"
import {
  AlertCircle,
  AlertTriangle,
  Boxes,
  CheckCircle2,
  Clock3,
  Database,
  FileDown,
  History,
  Loader2,
  LockKeyhole,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UnlockKeyhole
} from "lucide-react"
import { Suspense,lazy,useEffect,useMemo,useRef,useState,type MouseEvent as ReactMouseEvent } from "react"
import { toast } from "sonner"
import type {
  CatalogChange,
  CatalogImportReview,
  CatalogItem,
  CatalogResponse,
  ImportJob,
  ProductItem,
  SourceCatalogFacets,
  SourceCatalogFilters
} from "../App"
import {
  localDateKey,
  salesDateRangeBounds
} from "../App"
import { loadAppReferences } from "../lib/app-state"
import { channelFilterLabel } from "../lib/catalog-channel-utils"
import { api,dateLabel,moneyLabel,numberLabel } from "../lib/client-api"
import { readWorkspaceCache,writeWorkspaceCache } from "../lib/workspace-cache"
import { CategoryMappingOverview,MappingIndicator } from "./category-mapping-overview"
import { CategoryMappingWorkspace } from "./category-mapping-workspace"
import { ChannelCategoryPicker } from "./channel-category-picker"

const SalesAreaChart = lazy(() => import("./sales-report-charts").then((module) => ({ default: module.SalesAreaChart })))
const SalesChannelPieChart = lazy(() => import("./sales-report-charts").then((module) => ({ default: module.SalesChannelPieChart })))
const SalesShippingReport = lazy(() => import("./sales-shipping-report").then((module) => ({ default: module.SalesShippingReport })))
const WalmartCategoryMapping = lazy(() => import("./walmart-category-mapping").then((module) => ({ default: module.WalmartCategoryMapping })))

import { Detail,Field,PageHeader } from "./app-ui"
import { ProductDetailSheet } from "./product-workspaces"

export type CatalogWorkspaceTab = "products" | "review" | "changes" | "category-review" | "categories" | "mappings" | "ebay-blockers" | "ebay-sync-warnings" | "attributes" | "groups" | "inventory" | "templates" | "readiness"

type CategoryAttribute = {
  id?: string
  attributeId?: string
  attributeName?: string
  name?: string
  handle?: string
  description?: string
  required?: boolean
  recommended?: boolean
  sourceField?: string
  fallbackValue?: string
  transform?: string
  enabled?: boolean
  notes?: string
}

function categoryAttributesFromRows(rows: Array<Record<string, unknown>>): CategoryAttribute[] {
  return rows
    .filter((row) => String(row["Attribute"] || "").trim())
    .map((row) => ({
      id: String(row["Attribute ID"] || row["Attribute Handle"] || row["Attribute"] || ""),
      attributeId: String(row["Attribute ID"] || row["Attribute Handle"] || row["Attribute"] || ""),
      name: String(row["Attribute"] || ""),
      attributeName: String(row["Attribute"] || ""),
      handle: String(row["Attribute Handle"] || ""),
      required: String(row["Required"] || "").toLowerCase() === "true",
      recommended: String(row["Recommended"] || "").toLowerCase() === "true",
      sourceField: String(row["Mapped Source Field"] || ""),
      fallbackValue: String(row["Fallback Value"] || ""),
      enabled: String(row["Mapping Enabled"] || "").toLowerCase() !== "false",
    }))
}

type CategoryChannelMapping = {
  id?: string
  name?: string
  fullName?: string
  handle?: string
  categoryId?: string
  categoryPath?: string
  categoryHandle?: string
  collectionHandle?: string
  taxonomyVersion?: string
  status?: string
  notes?: string
  confidence?: number | null
  confidenceLevel?: string
  matchSource?: string
  matchedQuery?: string
  matchedAt?: string
  decision?: string
  deniedAt?: string
  deniedBy?: string
  blocked?: boolean
  blockedAt?: string
  blockedBy?: string
  blockReason?: string
  lastRefreshQueuedAt?: string
  lastRefreshStartedAt?: string
  lastRefreshAt?: string
  lastRefreshJobId?: string
  lastRefreshChanged?: number | null
  lastRefreshStatus?: string
  suggestionRank?: number | null
  categoryTreeVersion?: string
  reviewedBy?: string
  reviewedAt?: string
  aiProvider?: string
  aiModel?: string
  aiProposalId?: string
  aiRationale?: string
  locked?: boolean
  lockedAt?: string
  lockedBy?: string
  unlockedAt?: string
  unlockedBy?: string
  pendingSuggestion?: {
    action?: string
    categoryId?: string
    categoryPath?: string
    categoryHandle?: string
    taxonomyVersion?: string
    categoryTreeVersion?: string
    confidence?: number | null
    rationale?: string
    warnings?: string[]
    provider?: string
    model?: string
    reviewedAt?: string
    approvalToken?: string
  } | null
  googleCategory?: { id?: string; fullName?: string; breadcrumb?: string } | null
  attributes?: CategoryAttribute[]
  attributeMappings?: CategoryAttribute[]
  history?: Array<{
    id?: string
    action?: string
    categoryId?: string
    categoryPath?: string
    previousCategoryId?: string
    previousCategoryPath?: string
    confidence?: number | null
    source?: string
    actor?: string
    createdAt?: string
  }>
}

type CategoryPageSummary = Record<"shopify" | "ebay" | "walmart", {
  total: number
  mapped: number
  unmapped: number
  "auto-applied": number
  "awaiting-review": number
  manual: number
  highConfidence: number
  collectionMapped: number
}>

type CategoryProfile = {
  id?: string
  categoryId?: string
  name?: string
  productCount?: number
  activeProductCount?: number
  stockProductCount?: number
  sourceMappingCount?: number
  mappingCount?: number
  missingMappings?: number
  status?: string
  owner?: string
  notes?: string
  lifecycle?: string
  savedExists?: boolean
  canDelete?: boolean
  deleteBlockers?: string[]
  topVendors?: Array<{ name?: string; count?: number }>
  topBrands?: Array<{ name?: string; count?: number }>
  createdByLabel?: string
  createdAt?: string
  updatedAt?: string
  updatedBy?: string
  mappings?: Record<string, CategoryChannelMapping>
  smartCollection?: {
    enabled?: boolean
    productType?: string
    handle?: string
    title?: string
    bodyHtml?: string
    sortOrder?: string
    templateSuffix?: string
    published?: boolean
    publishedScope?: string
    mustMatch?: string
    ruleProductColumn?: string
    ruleRelation?: string
    imageSrc?: string
    imageAltText?: string
    titleTag?: string
    descriptionTag?: string
  }
  defaults?: {
    condition?: string
    countryOfOrigin?: string
    hazardousAllowed?: boolean
    packageWeightRequired?: boolean
    shippingProfile?: string
    returnPolicy?: string
  }
  requiredAttributes?: string[]
}

type CategoryMappingState = "auto-applied" | "awaiting-review" | "manual" | "unmapped"

function categoryMappingConfidence(mapping?: CategoryChannelMapping) {
  const value = mapping?.pendingSuggestion?.confidence ?? mapping?.confidence
  if (value === undefined || value === null || !Number.isFinite(Number(value))) return null
  return Math.max(0, Math.min(1, Number(value)))
}

function categoryMappingState(mapping?: CategoryChannelMapping): CategoryMappingState {
  if (!mapping) return "unmapped"
  if (mapping.pendingSuggestion || String(mapping.status || "").toLowerCase().includes("review")) return "awaiting-review"
  if (!mapping.categoryId) return "unmapped"
  const source = String(mapping.matchSource || "").toLowerCase()
  const status = String(mapping.status || "").toLowerCase()
  if (mapping.aiProposalId || status.includes("auto") || source.includes("david") || source.includes("ai") || source.includes("ranked") || source.includes("auto")) return "auto-applied"
  return "manual"
}

function CategoryMappingBadge({ channel, mapping }: { channel: "shopify" | "ebay" | "walmart"; mapping?: CategoryChannelMapping }) {
  const state = categoryMappingState(mapping)
  const confidence = categoryMappingConfidence(mapping)
  const score = confidence === null ? "" : `${Math.round(confidence * 100)}%`
  const label = mapping?.pendingSuggestion && !mapping.pendingSuggestion.categoryId ? 'No match found' : state === "auto-applied" ? `Approved (auto) ${score}` : state === "awaiting-review" ? `${mapping?.pendingSuggestion?.categoryId ? 'Suggested' : 'Needs review'} ${score}` : state === "manual" ? "Approved" : "Not reviewed yet"
  const className = state === "auto-applied"
    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
    : state === "awaiting-review"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
      : state === "manual"
        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        : "text-muted-foreground"
  return <div className="grid gap-1">
    <span className="text-[10px] font-semibold uppercase text-muted-foreground">{channel === "walmart" ? "Walmart" : channel === "shopify" ? "Shopify / Google" : "eBay"}</span>
    <Badge variant="outline" className={`w-fit whitespace-nowrap ${className}`}>{['manual', 'auto-applied'].includes(state) && <CheckCircle2 className="mr-1 size-3" />}{label.trim()}</Badge>
  </div>
}

function CategoryMappingHistory({ profile }: { profile: CategoryProfile }) {
  const rows = (["shopify", "ebay"] as const).flatMap((channel) => (profile.mappings?.[channel]?.history || []).map((entry) => ({ ...entry, channel })))
    .sort((left, right) => String(right.createdAt || "").localeCompare(String(left.createdAt || "")))
  if (!rows.length) return null
  return <Card>
    <CardHeader className="border-b"><CardTitle className="text-sm">Mapping history</CardTitle><CardDescription>Every approved, manual, lock, and unlock change retained for comparison.</CardDescription></CardHeader>
    <CardContent className="p-0"><div className="overflow-x-auto"><Table>
      <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Channel</TableHead><TableHead>Change</TableHead><TableHead>Previous</TableHead><TableHead>Current</TableHead><TableHead>Confidence</TableHead><TableHead>Actor</TableHead></TableRow></TableHeader>
      <TableBody>{rows.map((entry, index) => <TableRow key={entry.id || `${entry.channel}-${entry.createdAt}-${index}`}>
        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dateLabel(entry.createdAt)}</TableCell>
        <TableCell><Badge variant="outline">{entry.channel === "shopify" ? "Shopify / Google" : "eBay"}</Badge></TableCell>
        <TableCell className="whitespace-nowrap text-sm">{String(entry.action || "updated").replace(/-/g, " ")}</TableCell>
        <TableCell className="max-w-72 truncate text-xs text-muted-foreground">{entry.previousCategoryPath || entry.previousCategoryId || "-"}</TableCell>
        <TableCell className="max-w-72 truncate text-sm">{entry.categoryPath || entry.categoryId || "-"}</TableCell>
        <TableCell>{entry.confidence == null ? "-" : `${Math.round(Number(entry.confidence) * 100)}%`}</TableCell>
        <TableCell>{entry.actor || "System"}</TableCell>
      </TableRow>)}</TableBody>
    </Table></div></CardContent>
  </Card>
}

export const catalogWorkspaceTabs: Array<{ id: CatalogWorkspaceTab; label: string }> = [
  { id: "products", label: "Catalog" },
  { id: "review", label: "Import Review" },
  { id: "changes", label: "SKU Changes" },
  { id: "category-review", label: "Category Review" },
  { id: "categories", label: "Categories" },
  { id: "mappings", label: "Vendor Mappings" },
  { id: "ebay-blockers", label: "eBay Blockers" },
  { id: "ebay-sync-warnings", label: "eBay Sync Warnings" },
  { id: "attributes", label: "Attributes" },
  { id: "groups", label: "Attribute Groups" },
  { id: "inventory", label: "Inventory" },
  { id: "templates", label: "Templates" },
  { id: "readiness", label: "Readiness" },
]

export function catalogWorkspaceTabFromPath() {
  const path = window.location.pathname.toLowerCase()
  if (path.startsWith("/source-catalog") || path === "/source") return "products"
  if (path.startsWith("/import-review")) return "review"
  if (path.startsWith("/sku-changes")) return "changes"
  if (path.startsWith("/category-review")) return "category-review"
  if (path.startsWith("/ebay-blockers")) return "ebay-blockers"
  if (path.startsWith("/ebay-sync-warnings")) return "ebay-sync-warnings"
  if (path.startsWith("/categories")) return "categories"
  if (path.startsWith("/vendor-category-mappings")) return "mappings"
  if (path.startsWith("/attributes")) return "attributes"
  if (path.startsWith("/groups")) return "groups"
  if (path.startsWith("/inventory")) return "inventory"
  if (path.startsWith("/templates")) return "templates"
  if (path.startsWith("/readiness")) return "readiness"
  return "products"
}

function catalogCellValue(value: unknown) {
  if (value === undefined || value === null || value === "") return "-"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString() : "-"
  if (Array.isArray(value)) return value.slice(0, 3).join(", ") || "-"
  if (typeof value === "object") return "Configured"
  return String(value)
}

function CatalogRecordsTable({ rows, columns, empty }: { rows: Array<Record<string, unknown>>; columns: Array<[string, string]>; empty: string }) {
  if (!rows.length) return <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">{empty}</div>
  return <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow>{columns.map(([key, label]) => <TableHead key={key}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={String(row.id || row.sku || row.categoryId || row.vendorCategory || index)}>{columns.map(([key]) => <TableCell key={key} className="max-w-80"><span className="block truncate" title={catalogCellValue(row[key])}>{catalogCellValue(row[key])}</span></TableCell>)}</TableRow>)}</TableBody></Table></div>
}

function categoryProfileFrom(row: CategoryProfile): CategoryProfile {
  return {
    ...row,
    mappings: { ...(row.mappings || {}) },
    smartCollection: { ...(row.smartCollection || {}) },
    defaults: { ...(row.defaults || {}) },
    requiredAttributes: [...(row.requiredAttributes || [])],
  }
}

function categoryMissingCount(value?: unknown) {
  return Array.isArray(value) ? value.length : Number(value || 0)
}

type CategoryRequirementRow = CategoryAttribute & { channel: string }

type CategoryAiReviewProposal = {
  id: string
  state: "ready_for_approval" | "keep_current" | "no_match" | string
  categoryId: string
  categoryName: string
  channel: "shopify" | "ebay"
  current?: CategoryChannelMapping
  suggestion?: CategoryChannelMapping | null
  confidence?: number
  rationale?: string
  warnings?: string[]
  provider?: string
  model?: string
  expiresAt?: string
}

type CategoryReviewRow = {
  id?: string
  categoryId?: string
  name?: string
  status?: string
  lifecycle?: string
  productCount?: number
  activeProductCount?: number
  stockProductCount?: number
  topVendors?: Array<{ name?: string; count?: number }>
  mapping?: CategoryChannelMapping
  pendingSuggestion?: CategoryChannelMapping["pendingSuggestion"]
  confidence?: number | null
  updatedAt?: string
  reviewStatus?: string
  lastRefreshAt?: string
  lastRefreshJobId?: string
  lastRefreshChanged?: number | null
  lastRefreshStatus?: string
  locked?: boolean
}

type CategoryReviewResponse = {
  rows?: CategoryReviewRow[]
  summary?: { total?: number; pending?: number; mapped?: number; missing?: number; denied?: number; blocked?: number; pendingProducts?: number; mappedProducts?: number; blockedProducts?: number }
  total?: number
  page?: number
  pageSize?: number
  pageCount?: number
  channel?: "shopify" | "ebay"
  scope?: "main" | "source"
}

function CategoryRequirementsDataTable({ channel, attributes, mappings, onChange }: { channel: string; attributes: CategoryAttribute[]; mappings: CategoryAttribute[]; onChange: (next: CategoryAttribute[]) => void }) {
  const [globalFilter, setGlobalFilter] = useState("")
  const rows = useMemo<CategoryRequirementRow[]>(() => attributes.map((attribute) => ({ ...attribute, channel })), [attributes, channel])
  const helper = createColumnHelper<CategoryRequirementRow>()
  function mapped(attribute: CategoryRequirementRow) {
    return mappings.find((row) => (row.attributeId || row.id) === (attribute.id || attribute.name)) || {}
  }
  function update(attribute: CategoryRequirementRow, patch: Partial<CategoryAttribute>) {
    const id = attribute.id || attribute.name || ""
    const current = mapped(attribute)
    onChange([
      ...mappings.filter((row) => (row.attributeId || row.id) !== id),
      { ...attribute, ...current, attributeId: id, attributeName: attribute.name, enabled: true, ...patch },
    ])
  }
  const columns = useMemo(() => [
    helper.accessor("name", { header: "Requirement", cell: ({ row }) => <div><p className="font-medium">{row.original.name}</p><p className="text-xs text-muted-foreground">{row.original.handle || row.original.id}</p></div> }),
    helper.display({ id: "priority", header: "Priority", cell: ({ row }) => <Badge variant={row.original.required ? "destructive" : "outline"}>{row.original.required ? "Required" : row.original.recommended ? "Recommended" : "Optional"}</Badge> }),
    helper.display({ id: "source", header: "Source field", cell: ({ row }) => <Input value={mapped(row.original).sourceField || ""} onChange={(event) => update(row.original, { sourceField: event.target.value })} placeholder="e.g. brand" /> }),
    helper.display({ id: "fallback", header: "Fallback", cell: ({ row }) => <Input value={mapped(row.original).fallbackValue || ""} onChange={(event) => update(row.original, { fallbackValue: event.target.value })} placeholder="Optional default" /> }),
  ], [attributes, mappings])
  const table = useReactTable({ data: rows, columns, state: { globalFilter }, onGlobalFilterChange: setGlobalFilter, getCoreRowModel: getCoreRowModel(), getFilteredRowModel: getFilteredRowModel(), globalFilterFn: (row, _columnId, filterValue) => `${row.original.name} ${row.original.handle} ${row.original.description}`.toLowerCase().includes(String(filterValue).toLowerCase()) })

  return <div className="rounded-md border"><div className="flex flex-wrap items-center justify-between gap-3 border-b p-3"><div><p className="text-sm font-medium capitalize">{channel} requirements</p><p className="text-xs text-muted-foreground">{numberLabel(attributes.length)} taxonomy fields. Values are saved only when you save this channel.</p></div><div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="h-9 w-56 pl-9" value={globalFilter} onChange={(event) => setGlobalFilter(event.target.value)} placeholder="Filter requirements" /></div></div><div className="overflow-x-auto"><Table><TableHeader>{table.getHeaderGroups().map((group) => <TableRow key={group.id}>{group.headers.map((header) => <TableHead key={header.id}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</TableHead>)}</TableRow>)}</TableHeader><TableBody>{table.getRowModel().rows.map((row) => <TableRow key={row.id}>{row.getVisibleCells().map((cell) => <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>)}</TableRow>)}{!table.getRowModel().rows.length && <TableRow><TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">{attributes.length ? "No requirements match this filter." : `This ${channel} taxonomy has no channel-specific attributes.`}</TableCell></TableRow>}</TableBody></Table></div></div>
}

function CategoryMappingLockControl({ channel, mapping, busy, onChange }: { channel: "shopify" | "ebay"; mapping: CategoryChannelMapping; busy: boolean; onChange: (locked: boolean) => Promise<boolean> }) {
  const [unlockOpen, setUnlockOpen] = useState(false)
  const locked = mapping.locked === true
  const hasMapping = Boolean(mapping.categoryId || mapping.categoryPath)
  const channelLabel = channel === "shopify" ? "Shopify / Google" : "eBay"
  return <div className={cn("flex flex-wrap items-center justify-between gap-3 rounded-md border p-3", locked ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5")}>
    <div className="flex min-w-0 items-start gap-3">
      <div className={cn("grid size-9 shrink-0 place-items-center rounded-md", locked ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300")}>{locked ? <LockKeyhole className="size-4" /> : <UnlockKeyhole className="size-4" />}</div>
      <div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{channelLabel} mapping</p><Badge variant={locked ? "default" : "outline"}>{locked ? "Locked" : "Editable"}</Badge></div><p className="mt-0.5 text-xs text-muted-foreground">{locked ? `Protected${mapping.lockedBy ? ` by ${mapping.lockedBy}` : ""}. Unlock before replacing the taxonomy category.` : "Taxonomy changes are allowed. Lock the approved category to protect future imports and AI reviews."}</p></div>
    </div>
    {locked
      ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setUnlockOpen(true)}><UnlockKeyhole className="size-4" /> Unlock mapping</Button>
      : <Button type="button" size="sm" variant="outline" disabled={busy || !hasMapping} onClick={() => void onChange(true)}><LockKeyhole className="size-4" /> Lock mapping</Button>}
    <AlertDialog open={unlockOpen} onOpenChange={setUnlockOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Unlock this {channelLabel} mapping?</AlertDialogTitle><AlertDialogDescription>This allows a user or an approved David action to replace the current taxonomy category. The unlock is recorded with the user and timestamp.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>Keep locked</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={(event) => { event.preventDefault(); void onChange(false).then((changed) => { if (changed) setUnlockOpen(false) }) }}>{busy ? <Loader2 className="size-4 animate-spin" /> : <UnlockKeyhole className="size-4" />} Unlock mapping</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}

function DavidCategoryReviewCard({ profile, channel, scope, onApplied }: { profile: CategoryProfile; channel: "shopify" | "ebay"; scope: "main" | "source"; onApplied: (mapping: CategoryChannelMapping) => void }) {
  const [proposal, setProposal] = useState<CategoryAiReviewProposal | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [reviewError, setReviewError] = useState("")
  const [applying, setApplying] = useState(false)
  const [approveOpen, setApproveOpen] = useState(false)
  const resultRef = useRef<HTMLDivElement | null>(null)
  const profileId = profile.id || profile.categoryId || ""
  const current = profile.mappings?.[channel] || {}
  const confidence = Math.round(Number(proposal?.confidence || 0) * 100)

  useEffect(() => { setProposal(null); setReviewError(""); setApproveOpen(false) }, [profileId, channel])

  function revealResult() {
    window.requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }))
  }

  async function review() {
    if (!profileId) return
    setReviewing(true)
    setReviewError("")
    setProposal(null)
    revealResult()
    try {
      const result = await api<{ proposal?: CategoryAiReviewProposal }>(`/api/ai/categories/${encodeURIComponent(profileId)}/review`, {
        method: "POST",
        body: JSON.stringify({ scope, channel }),
      })
      if (!result.proposal?.id || !result.proposal.state) throw new Error("David completed the request but returned no category review result. Please retry the review.")
      setProposal(result.proposal)
      revealResult()
      toast.success(`David reviewed the ${channel === "shopify" ? "Shopify" : "eBay"} mapping.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : "David could not review this category."
      setReviewError(message)
      revealResult()
      toast.error(message)
    } finally {
      setReviewing(false)
    }
  }

  async function applySuggestion() {
    if (!profileId || !proposal?.id) return
    setApplying(true)
    try {
      const result = await api<{ mapping?: CategoryChannelMapping; message?: string }>(`/api/ai/categories/${encodeURIComponent(profileId)}/apply`, {
        method: "POST",
        body: JSON.stringify({ proposalId: proposal.id, reviewedBy: "Luis" }),
      })
      if (!result.mapping) throw new Error("The mapping was saved, but the server did not return the approved record. Refresh and try again.")
      onApplied(result.mapping)
      setApproveOpen(false)
      setProposal(null)
      toast.success(result.message || "David's category suggestion was approved and saved.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to apply David's category suggestion.")
    } finally {
      setApplying(false)
    }
  }

  const stateLabel = proposal?.state === "ready_for_approval" ? "Approval required" : proposal?.state === "keep_current" ? "Current mapping confirmed" : proposal?.state === "no_match" ? "No safe match" : "Not reviewed"
  return <section className="rounded-md border border-primary/20 bg-primary/[0.025] p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><ShieldCheck className="size-4" /></div><div><p className="text-sm font-medium">David category review</p><p className="mt-0.5 text-xs text-muted-foreground">Independent AI review of the deterministic {channel === "shopify" ? "Shopify" : "eBay"} taxonomy match. Suggestions require your approval.</p></div></div>
      <Button variant="outline" size="sm" disabled={reviewing || applying} onClick={() => void review()}>{reviewing ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}{proposal ? "Review again" : "Ask David to review"}</Button>
    </div>
    <div ref={resultRef} className="scroll-mt-24" aria-live="polite" aria-busy={reviewing}>
      {reviewing && <div className="mt-4 flex items-start gap-3 rounded-md border border-primary/30 bg-primary/5 p-3"><Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" /><div><p className="text-sm font-medium">David is reviewing this category</p><p className="mt-0.5 text-xs text-muted-foreground">Comparing the current mapping with the locally cached {channel === "shopify" ? "Shopify / Google" : "eBay"} taxonomy. The result will appear here automatically.</p></div></div>}
      {reviewError && !reviewing && <Alert variant="destructive" className="mt-4"><AlertCircle className="size-4" /><AlertTitle>David could not complete the review</AlertTitle><AlertDescription className="space-y-3"><p>{reviewError}</p><Button variant="outline" size="sm" onClick={() => void review()}><RefreshCw className="size-4" /> Retry review</Button></AlertDescription></Alert>}
    </div>
    {proposal && <div className="mt-4 grid gap-3">
      <div className="flex flex-wrap items-center gap-2"><Badge variant={proposal.state === "ready_for_approval" ? "secondary" : proposal.state === "keep_current" ? "default" : "outline"}>{stateLabel}</Badge><Badge variant="outline">{confidence}% confidence</Badge><span className="text-xs text-muted-foreground">{proposal.provider}{proposal.model ? ` / ${proposal.model}` : ""}</span></div>
      <div className="grid gap-3 md:grid-cols-2"><div className="rounded-md border bg-background p-3"><p className="text-xs font-medium text-muted-foreground">Current mapping</p><p className="mt-1 text-sm font-medium">{proposal.current?.categoryPath || current.categoryPath || "Not mapped"}</p>{(proposal.current?.categoryId || current.categoryId) && <p className="mt-1 text-xs text-muted-foreground">ID: {proposal.current?.categoryId || current.categoryId}</p>}</div><div className="ai-result-surface rounded-md border p-3"><p className="text-xs font-medium">David's result</p><p className="mt-1 text-sm font-semibold">{proposal.state === "keep_current" ? "Keep the current mapping" : proposal.suggestion?.categoryPath || "No accurate taxonomy match found"}</p>{proposal.suggestion?.categoryId && <p className="mt-1 text-xs">ID: {proposal.suggestion.categoryId}</p>}</div></div>
      {proposal.rationale && <div className="ai-result-surface rounded-md border p-3"><p className="text-xs font-medium">Why David chose this</p><p className="mt-1 text-sm">{proposal.rationale}</p></div>}
      {Boolean(proposal.warnings?.length) && <Alert><AlertCircle className="size-4" /><AlertTitle>Review warnings</AlertTitle><AlertDescription>{proposal.warnings?.join(" ")}</AlertDescription></Alert>}
      {proposal.state === "ready_for_approval" && <div className="flex justify-end"><Button size="sm" onClick={() => setApproveOpen(true)}><CheckCircle2 className="size-4" /> Review and approve</Button></div>}
    </div>}
    <AlertDialog open={approveOpen} onOpenChange={setApproveOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Apply David's {channel === "shopify" ? "Shopify" : "eBay"} category suggestion?</AlertDialogTitle><AlertDialogDescription>This saves <strong>{proposal?.suggestion?.categoryPath || proposal?.suggestion?.categoryId}</strong> to <strong>{profile.name}</strong>. DataPlus will reject the change if the mapping was edited after David reviewed it.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={applying}>Cancel</AlertDialogCancel><AlertDialogAction disabled={applying} onClick={(event) => { event.preventDefault(); void applySuggestion() }}>{applying ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Approve mapping</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>
}

function PendingCategorySuggestionCard({ profile, channel, onApplied }: { profile: CategoryProfile; channel: "shopify" | "ebay"; onApplied: (mapping: CategoryChannelMapping) => void }) {
  const [applying, setApplying] = useState(false)
  const [approveOpen, setApproveOpen] = useState(false)
  const suggestion = profile.mappings?.[channel]?.pendingSuggestion
  const profileId = profile.id || profile.categoryId || ""
  if (!suggestion) return <p role="status" className="text-xs text-muted-foreground">{profile.mappings?.[channel]?.categoryId ? 'Approved mapping. No pending suggestion.' : 'Not reviewed yet. No saved suggestion.'}</p>
  const confidence = Math.round(Number(suggestion.confidence || 0) * 100)
  const canApply = Boolean(suggestion.categoryId)
  const locked = profile.mappings?.[channel]?.locked === true

  async function applySuggestion() {
    if (!profileId || !canApply) return
    setApplying(true)
    try {
      const result = await api<{ mapping?: CategoryChannelMapping; message?: string }>(`/api/ai/categories/${encodeURIComponent(profileId)}/pending/apply`, {
        method: "POST",
        body: JSON.stringify({ channel, reviewedBy: "Luis", expectedSuggestion: { categoryId: suggestion?.categoryId, reviewedAt: suggestion?.reviewedAt || '' } }),
      })
      if (!result.mapping) throw new Error("The approved mapping was not returned. Refresh and try again.")
      onApplied(result.mapping)
      setApproveOpen(false)
      toast.success(result.message || "David's category suggestion was approved and locked.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to approve the pending category suggestion.")
    } finally {
      setApplying(false)
    }
  }

  return <section className="rounded-md border border-amber-500/40 bg-amber-500/5 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3"><div className="grid size-9 shrink-0 place-items-center rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300"><AlertTriangle className="size-4" /></div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{canApply ? 'Suggested - awaiting approval' : 'No match found'}</p>{suggestion.confidence != null && <Badge variant="outline">{confidence}% confidence</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">Source: {suggestion.provider === 'repository' ? 'Cached taxonomy matching' : suggestion.provider || 'Saved category review'}</p></div></div>
      {canApply && <Button size="sm" disabled={applying || locked} onClick={() => setApproveOpen(true)}><CheckCircle2 className="size-4" /> Approve mapping</Button>}
    </div>
    <div className="mt-4 grid gap-3">
      <div className="ai-result-surface rounded-md border p-3"><p className="text-xs font-medium">Suggested {channel === "shopify" ? "Shopify / Google" : "eBay"} category</p><p className="mt-1 text-sm font-semibold">{suggestion.categoryPath || suggestion.categoryId || "No accurate taxonomy match found"}</p>{suggestion.categoryId && <p className="mt-1 text-xs">ID: {suggestion.categoryId}</p>}</div>
      {suggestion.rationale && <p className="ai-result-text text-sm">{suggestion.rationale}</p>}
      {Boolean(suggestion.warnings?.length) && <p className="text-xs text-amber-800 dark:text-amber-200">{suggestion.warnings?.join(" ")}</p>}
      {!canApply && <p className="text-xs text-muted-foreground">No category was safe enough to suggest. Search the taxonomy manually or ask David to review this category again.</p>}
      {canApply && locked && <p className="text-xs text-amber-800 dark:text-amber-200">Protected mapping. Unlock in Protection & review before approving a replacement.</p>}
    </div>
    <AlertDialog open={approveOpen} onOpenChange={setApproveOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Approve and lock this {channel === "shopify" ? "Shopify" : "eBay"} mapping?</AlertDialogTitle><AlertDialogDescription>This saves <strong>{suggestion.categoryPath || suggestion.categoryId}</strong>. The mapping is locked so later background reviews cannot replace it unless a user unlocks it.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={applying}>Cancel</AlertDialogCancel><AlertDialogAction disabled={applying} onClick={(event) => { event.preventDefault(); void applySuggestion() }}>{applying ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Approve and lock</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </section>
}

export function CategoriesWorkspace({ categoryId = "", standalone = false, initialScope = "main" }: { categoryId?: string; standalone?: boolean; initialScope?: "main" | "source" }) {
  const [categories, setCategories] = useState<CategoryProfile[]>([])
  const [selectedId, setSelectedId] = useState(categoryId)
  const [profile, setProfile] = useState<CategoryProfile | null>(null)
  const [categoryScope, setCategoryScope] = useState<"main" | "source">(initialScope)
  const [query, setQuery] = useState("")
  const [channelFilter, setChannelFilter] = useState(new URLSearchParams(window.location.search).get("channel") === "walmart" ? "walmart" : "shopify")
  const [mappingFilter, setMappingFilter] = useState("")
  const [reviewFilter, setReviewFilter] = useState("")
  const [confidenceFilter, setConfidenceFilter] = useState("")
  const [lifecycleFilter, setLifecycleFilter] = useState("")
  const [minimumProducts, setMinimumProducts] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [totalCategories, setTotalCategories] = useState(0)
  const [pageCount, setPageCount] = useState(1)
  const [categorySummary, setCategorySummary] = useState<CategoryPageSummary | null>(null)
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(new Set())
  const [bulkWorking, setBulkWorking] = useState(false)
  const [approvalProgress, setApprovalProgress] = useState<{ total: number; done: number; approved: number; errors: string[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [profileTab, setProfileTab] = useState(new URLSearchParams(window.location.search).get("channel") === "walmart" ? "walmart" : "overview")
  const [shopifyQuery, setShopifyQuery] = useState("")
  const [shopifyResults, setShopifyResults] = useState<CategoryChannelMapping[]>([])
  const [ebayQuery, setEbayQuery] = useState("")
  const [ebayResults, setEbayResults] = useState<CategoryChannelMapping[]>([])
  const [ebaySearchMessage, setEbaySearchMessage] = useState("")
  const [ebaySearchWarning, setEbaySearchWarning] = useState("")
  const [taxonomyLoading, setTaxonomyLoading] = useState<"shopify" | "ebay" | "">("")
  const [channelRequirements, setChannelRequirements] = useState<Record<string, CategoryAttribute[]>>({})
  const [requirementsLoading, setRequirementsLoading] = useState<Record<string, boolean>>({})
  const [ebayAutoMapOpen, setEbayAutoMapOpen] = useState(false)
  const [ebayAutoMapping, setEbayAutoMapping] = useState(false)
  const [refreshAfterEbayAutoMap, setRefreshAfterEbayAutoMap] = useState(true)
  const [aiReviewOpen, setAiReviewOpen] = useState(false)
  const [aiReviewing, setAiReviewing] = useState(false)
  const [aiReviewChannels, setAiReviewChannels] = useState<Array<"shopify" | "ebay">>(["shopify", "ebay"])
  const [refreshPendingAi, setRefreshPendingAi] = useState(false)
  const [categoryRefreshPrompt, setCategoryRefreshPrompt] = useState<{ sourceId: string; categoryName: string; channel: "shopify" | "ebay"; productCount: number } | null>(null)
  const [refreshExistingSkus, setRefreshExistingSkus] = useState(true)
  const [refreshChannelRecords, setRefreshChannelRecords] = useState(true)
  const [refreshTiming, setRefreshTiming] = useState<"now" | "later">("now")
  const [refreshAt, setRefreshAt] = useState("")
  const [refreshMarketplaceReview, setRefreshMarketplaceReview] = useState(false)
  const [bulkRefreshOpen, setBulkRefreshOpen] = useState(false)
  const [refreshSubmitting, setRefreshSubmitting] = useState(false)
  const [lastCategoryRefresh, setLastCategoryRefresh] = useState<{ id?: string; jobNumber?: number; scheduledFor?: string; channel: string } | null>(null)

  const selected = useMemo(() => categories.find((row) => (row.id || row.categoryId) === selectedId) || null, [categories, selectedId])
  const visibleCategories = useMemo(() => {
    if (!standalone) return categories
    const value = query.trim().toLowerCase()
    return categories.filter((row) => {
      const shopifyMapped = Boolean(row.mappings?.shopify?.categoryId)
      const shopifyCollectionMapped = Boolean(row.mappings?.shopify?.collectionHandle || row.smartCollection?.handle)
      const ebayMapped = Boolean(row.mappings?.ebay?.categoryId)
      const mapped = Boolean(row.mappings?.[channelFilter]?.categoryId)
      if (mappingFilter === "mapped" && !mapped) return false
      if (mappingFilter === "missing" && mapped) return false
      if (mappingFilter === "fully-mapped" && !(shopifyMapped && shopifyCollectionMapped && ebayMapped)) return false
      if (mappingFilter === "missing-shopify" && shopifyMapped) return false
      if (mappingFilter === "missing-collection" && shopifyCollectionMapped) return false
      if (mappingFilter === "missing-ebay" && ebayMapped) return false
      const selectedMapping = row.mappings?.[channelFilter]
      const selectedMappingState = categoryMappingState(selectedMapping)
      const selectedConfidence = categoryMappingConfidence(selectedMapping)
      if (reviewFilter && selectedMappingState !== reviewFilter) return false
      if (confidenceFilter === "high" && (selectedConfidence === null || selectedConfidence < 0.75)) return false
      if (confidenceFilter === "medium" && (selectedConfidence === null || selectedConfidence < 0.5 || selectedConfidence >= 0.75)) return false
      if (confidenceFilter === "low" && (selectedConfidence === null || selectedConfidence >= 0.5)) return false
      if (confidenceFilter === "none" && selectedConfidence !== null) return false
      if (lifecycleFilter && row.lifecycle !== lifecycleFilter) return false
      if (Number(minimumProducts || 0) > Number(row.productCount || 0)) return false
      return !value || `${row.id} ${row.name} ${row.status} ${row.owner} ${Object.values(row.mappings || {}).map((mapping) => mapping.categoryPath).join(" ")} ${(row.topVendors || []).map((vendor) => vendor.name).join(" ")} ${(row.topBrands || []).map((brand) => brand.name).join(" ")}`.toLowerCase().includes(value)
    })
  }, [standalone, categories, query, channelFilter, mappingFilter, reviewFilter, confidenceFilter, lifecycleFilter, minimumProducts])

  function applyCategories(rows: CategoryProfile[], nextId = categoryId || selectedId) {
    const normalizedRows = rows.map((row) => ({ ...row, missingMappings: categoryMissingCount(row.missingMappings) }))
    setCategories(normalizedRows)
    let decodedNextId = nextId
    try {
      decodedNextId = decodeURIComponent(nextId)
    } catch {
      decodedNextId = nextId
    }
    const next = normalizedRows.find((row) => (row.id || row.categoryId) === nextId) ||
      normalizedRows.find((row) => String(row.name || "").toLowerCase() === String(decodedNextId || "").toLowerCase()) ||
      (!categoryId ? normalizedRows[0] : null)
    setSelectedId(next?.id || next?.categoryId || "")
    setProfile(next ? categoryProfileFrom(next) : null)
  }

  async function load() {
    setLoading(true)
    try {
      if (standalone) {
        const result = await api<{ categories?: CategoryProfile[] }>(`/api/categories?scope=${categoryScope}`)
        applyCategories(result.categories || [])
        return
      }
      const params = new URLSearchParams({
        scope: categoryScope,
        q: query.trim(),
        channel: channelFilter,
        mapping: mappingFilter,
        review: reviewFilter,
        confidence: confidenceFilter,
        lifecycle: lifecycleFilter,
        minimumProducts,
        page: String(page),
        pageSize: String(pageSize),
      })
      const result = await api<{ categories?: CategoryProfile[]; total?: number; page?: number; pageCount?: number; summary?: CategoryPageSummary }>(`/api/categories/page?${params}`)
      applyCategories(result.categories || [])
      setTotalCategories(Number(result.total || 0))
      setPage(Number(result.page || 1))
      setPageCount(Number(result.pageCount || 1))
      setCategorySummary(result.summary || null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load categories.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (standalone) {
      void load()
      return
    }
    const timeout = window.setTimeout(() => void load(), 300)
    return () => window.clearTimeout(timeout)
  }, [standalone, categoryScope, query, channelFilter, mappingFilter, reviewFilter, confidenceFilter, lifecycleFilter, minimumProducts, page, pageSize])

  useEffect(() => {
    if (standalone) return
    setPage(1)
    setSelectedCategoryIds(new Set())
  }, [standalone, categoryScope, query, channelFilter, mappingFilter, reviewFilter, confidenceFilter, lifecycleFilter, minimumProducts, pageSize])

  useEffect(() => { if (categoryId) setSelectedId(categoryId) }, [categoryId])

  useEffect(() => {
    if (selected) setProfile(categoryProfileFrom(selected))
    setEditing(false)
  }, [selectedId])

  useEffect(() => {
    const profileId = profile?.id || profile?.categoryId
    if (!standalone || !profileId) return
    setChannelRequirements({})
    void loadChannelRequirements("shopify")
    void loadChannelRequirements("ebay")
  }, [standalone, profile?.id, profile?.categoryId])

  function updateProfile(update: Partial<CategoryProfile>) {
    setProfile((current) => current ? { ...current, ...update } : current)
  }

  function applySavedMapping(channel: "shopify" | "ebay", nextMapping: CategoryChannelMapping) {
    setProfile((current) => current ? {
      ...current,
      mappings: { ...(current.mappings || {}), [channel]: { ...nextMapping } },
    } : current)
    setCategories((current) => current.map((row) => (row.id || row.categoryId) === (profile?.id || profile?.categoryId)
      ? { ...row, mappings: { ...(row.mappings || {}), [channel]: { ...nextMapping } } }
      : row))
  }

  function defaultCategoryRefreshTime() {
    const date = new Date(Date.now() + 60 * 60 * 1000)
    date.setSeconds(0, 0)
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  }

  function openCategoryRefresh(channel: "shopify" | "ebay") {
    const sourceId = profile?.id || profile?.categoryId || ""
    if (!sourceId) return
    setRefreshExistingSkus(true)
    setRefreshChannelRecords(true)
    setRefreshTiming("now")
    setRefreshAt(defaultCategoryRefreshTime())
    setCategoryRefreshPrompt({ sourceId, categoryName: profile?.name || "this category", channel, productCount: Number(profile?.productCount || 0) })
  }

  async function queueCategoryRefresh() {
    if (!categoryRefreshPrompt) return
    if (!refreshExistingSkus && !refreshChannelRecords) {
      toast.error("Select at least one refresh scope.")
      return
    }
    let scheduledFor = ""
    if (refreshTiming === "later") {
      const selectedTime = new Date(refreshAt)
      if (!refreshAt || Number.isNaN(selectedTime.getTime()) || selectedTime.getTime() <= Date.now()) {
        toast.error("Choose a future time for this refresh.")
        return
      }
      scheduledFor = selectedTime.toISOString()
    }
    setRefreshSubmitting(true)
    try {
      const result = await api<{ job?: { id?: string; jobNumber?: number; scheduledFor?: string }; message?: string }>(`/api/categories/${encodeURIComponent(categoryRefreshPrompt.sourceId)}/apply-channel-to-products`, {
        method: "POST",
        body: JSON.stringify({
          scope: categoryScope,
          channel: categoryRefreshPrompt.channel,
          background: true,
          force: true,
          updateExistingSkus: refreshExistingSkus,
          updateChannelRecords: refreshChannelRecords,
          createMarketplaceReview: refreshMarketplaceReview,
          scheduledFor,
        }),
      })
      const nextJob = { id: result.job?.id, jobNumber: result.job?.jobNumber, scheduledFor: result.job?.scheduledFor || scheduledFor, channel: categoryRefreshPrompt.channel }
      setLastCategoryRefresh(nextJob)
      setCategoryRefreshPrompt(null)
      const jobLabel = nextJob.jobNumber ? `Job #${nextJob.jobNumber}` : "The category refresh"
      toast.success(scheduledFor ? `${jobLabel} is scheduled for ${dateLabel(scheduledFor)}.` : `${jobLabel} was queued.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue the category refresh.")
    } finally {
      setRefreshSubmitting(false)
    }
  }

  function updateMapping(channel: string, update: Partial<CategoryChannelMapping>) {
    const currentMapping = profile?.mappings?.[channel] || {}
    const replacesTaxonomy = (Object.prototype.hasOwnProperty.call(update, "categoryId") && update.categoryId !== currentMapping.categoryId) ||
      (Object.prototype.hasOwnProperty.call(update, "categoryPath") && update.categoryPath !== currentMapping.categoryPath)
    if (currentMapping.locked && replacesTaxonomy) {
      toast.error("Unlock this mapping before replacing its taxonomy category.")
      return
    }
    const nextUpdate = Object.prototype.hasOwnProperty.call(update, "categoryId")
      ? { ...update, confidence: null, confidenceLevel: "", matchSource: "manual", matchedAt: new Date().toISOString(), reviewedBy: "Luis", reviewedAt: new Date().toISOString(), suggestionRank: null, aiProvider: "", aiModel: "", aiProposalId: "", aiRationale: "" }
      : update
    setProfile((current) => current ? {
      ...current,
      mappings: { ...(current.mappings || {}), [channel]: { ...(current.mappings?.[channel] || {}), ...nextUpdate } },
    } : current)
  }

  async function save(update: Record<string, unknown> = {}) {
    if (!profile?.id && !profile?.categoryId) return false
    setSaving(true)
    try {
      const result = await api<{ category?: CategoryProfile; categories?: CategoryProfile[] }>(`/api/categories/${encodeURIComponent(profile.id || profile.categoryId || "")}?scope=${categoryScope}`, {
        method: "PATCH",
        body: JSON.stringify({ scope: categoryScope, updatedBy: "Luis", ...update }),
      })
      if (result.category) {
        const saved = result.category
        const merge = (row: CategoryProfile) => ({ ...row, ...saved, mappings: { ...row.mappings, ...saved.mappings } })
        setCategories(rows => rows.map(row => (row.id || row.categoryId) === (profile.id || profile.categoryId) ? merge(row) : row))
        setProfile(categoryProfileFrom(merge(profile)))
      } else {
        applyCategories(result.categories || [], profile.id || profile.categoryId)
      }
      toast.success("Category saved.")
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save category.")
      return false
    } finally {
      setSaving(false)
    }
  }

  async function saveOverview() {
    if (!profile) return false
    return save({ status: profile.status, owner: profile.owner, notes: profile.notes })
  }

  async function saveChannel(channel: "shopify" | "ebay", refresh = true) {
    if (!profile) return false
    const saved = await save({ channel, mapping: profile.mappings?.[channel] || {}, smartCollection: channel === "shopify" ? profile.smartCollection : undefined })
    if (saved && refresh && profile.mappings?.[channel]?.categoryId) openCategoryRefresh(channel)
    return saved
  }

  function cancelEditing() {
    if (selected) setProfile(categoryProfileFrom(selected))
    setShopifyResults([])
    setEbayResults([])
    setEditing(false)
  }

  async function saveActiveSection() {
    const saved = profileTab === "shopify" || profileTab === "ebay"
      ? await saveChannel(profileTab)
      : await saveOverview()
    if (saved) setEditing(false)
  }

  async function setMappingLock(channel: "shopify" | "ebay", locked: boolean) {
    if (!profile?.id && !profile?.categoryId) return false
    setSaving(true)
    try {
      const result = await api<{ mapping?: CategoryChannelMapping; message?: string }>(`/api/categories/${encodeURIComponent(profile.id || profile.categoryId || "")}/mappings/${channel}/lock?scope=${categoryScope}`, {
        method: "POST",
        body: JSON.stringify({ scope: categoryScope, locked, updatedBy: "Luis" }),
      })
      if (!result.mapping) throw new Error("The mapping state was not returned. Refresh and try again.")
      applySavedMapping(channel, result.mapping)
      toast.success(result.message || (locked ? "Category mapping locked." : "Category mapping unlocked."))
      if (!locked) setEditing(true)
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to change the mapping lock.")
      return false
    } finally {
      setSaving(false)
    }
  }

  async function loadChannelRequirements(channel: "shopify" | "ebay") {
    const profileId = profile?.id || profile?.categoryId
    if (!profileId) return
    setRequirementsLoading((current) => ({ ...current, [channel]: true }))
    try {
      const params = new URLSearchParams({ channel, categoryId: profileId })
      const result = await api<{ rows?: Array<Record<string, unknown>> }>(`/api/categories/attributes?${params}`)
      setChannelRequirements((current) => ({ ...current, [channel]: categoryAttributesFromRows(result.rows || []) }))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to load ${channel} requirements.`)
    } finally {
      setRequirementsLoading((current) => ({ ...current, [channel]: false }))
    }
  }

  async function syncAttributes() {
    if (!profile?.id && !profile?.categoryId) return
    setSaving(true)
    try {
      const result = await api<{ categories?: CategoryProfile[] }>(`/api/categories/${encodeURIComponent(profile.id || profile.categoryId || "")}/attributes/sync?scope=${categoryScope}`, {
        method: "POST",
        body: JSON.stringify({ scope: categoryScope, updatedBy: "Luis" }),
      })
      applyCategories(result.categories || [], profile.id || profile.categoryId)
      toast.success("Marketplace requirements synchronized.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to synchronize requirements.")
    } finally {
      setSaving(false)
    }
  }

  async function rebuildIndex() {
    setRebuilding(true)
    try {
      await api("/api/categories/summary-index/rebuild", { method: "POST", body: JSON.stringify({ scope: categoryScope }) })
      await load()
      toast.success("Main category index rebuilt.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to rebuild the category index.")
    } finally {
      setRebuilding(false)
    }
  }

  async function queueEbayAutoMap() {
    setEbayAutoMapping(true)
    try {
      const result = await api<{ job?: { id?: string; jobNumber?: number }; requested?: number; message?: string }>("/api/channel-taxonomies/ebay/map-current", {
        method: "POST",
        body: JSON.stringify({ scope: categoryScope, autoApproveThreshold: 0.75, checkpointEvery: 25, refreshAffectedProducts: refreshAfterEbayAutoMap }),
      })
      setEbayAutoMapOpen(false)
      const jobLabel = result.job?.jobNumber ? `Job #${result.job.jobNumber}` : "The eBay mapping job"
      toast.success(`${jobLabel} was queued. Open Jobs to follow mapping${refreshAfterEbayAutoMap ? " and the affected-SKU refresh" : ""}, then download the review files.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue eBay category mapping.")
    } finally {
      setEbayAutoMapping(false)
    }
  }

  async function queueAiReview() {
    if (!aiReviewChannels.length) {
      toast.error("Select at least one channel for David to review.")
      return
    }
    setAiReviewing(true)
    try {
      const result = await api<{ job?: { id?: string; jobNumber?: number }; requested?: number; message?: string }>("/api/ai/categories/review-all", {
        method: "POST",
        body: JSON.stringify({ channels: aiReviewChannels, refreshPending: refreshPendingAi }),
      })
      setAiReviewOpen(false)
      const jobLabel = result.job?.jobNumber ? `Job #${result.job.jobNumber}` : "The category review job"
      toast.success(`${jobLabel} was queued. High-confidence mappings will be approved and locked; the rest will stay in the approval queue.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue David's category review.")
    } finally {
      setAiReviewing(false)
    }
  }

  async function approveSelectedSuggestions() {
    const channel = channelFilter === "walmart" ? "walmart" : channelFilter === "ebay" ? "ebay" : "shopify"
    const eligible = categories.filter((row) => selectedCategoryIds.has(row.id || row.categoryId || "") && row.mappings?.[channel]?.pendingSuggestion?.categoryId)
    if (!eligible.length) {
      toast.error(`None of the selected categories has a pending ${channel === "walmart" ? "Walmart" : channel === "shopify" ? "Shopify / Google" : "eBay"} suggestion.`)
      return
    }
    setBulkWorking(true)
    let approved = 0
    let failed = 0
    const errors: string[] = []
    setApprovalProgress({ total: eligible.length, done: 0, approved: 0, errors: [] })
    for (const row of eligible) {
      try {
        await api(channel === "walmart" ? '/api/walmart/mapping/approve' : `/api/ai/categories/${encodeURIComponent(row.id || row.categoryId || "")}/pending/apply`, {
          method: "POST",
          body: JSON.stringify(channel === "walmart" ? { category: row.name, approvalToken: row.mappings?.walmart?.pendingSuggestion?.approvalToken } : { channel, scope: categoryScope, reviewedBy: "Luis", expectedSuggestion: { categoryId: row.mappings?.[channel]?.pendingSuggestion?.categoryId, reviewedAt: row.mappings?.[channel]?.pendingSuggestion?.reviewedAt || '' } }),
        })
        approved += 1
      } catch (error) {
        failed += 1
        errors.push(`${row.name}: ${error instanceof Error ? error.message : 'Approval failed'}`)
      }
      setApprovalProgress({ total: eligible.length, done: approved + failed, approved, errors: [...errors] })
    }
    setBulkWorking(false)
    setSelectedCategoryIds(new Set())
    await load()
    if (approved) toast.success(`${numberLabel(approved)} ${channel} suggestions approved and locked.`)
    if (failed) toast.error(`${numberLabel(failed)} suggestions could not be approved. Review their category details.`)
  }

  async function refreshSelectedCategories() {
    if (String(channelFilter) === 'walmart') { toast.error('Walmart uses approved mappings for future previews. Bulk product refresh is not supported.'); return }
    const channel = channelFilter === "walmart" ? "walmart" : channelFilter === "ebay" ? "ebay" : "shopify"
    const eligible = categories.filter((row) => selectedCategoryIds.has(row.id || row.categoryId || "") && row.mappings?.[channel]?.categoryId)
    if (!eligible.length) {
      toast.error(`None of the selected categories has a saved ${channel} mapping.`)
      return
    }
    let scheduledFor = ""
    if (refreshTiming === "later") {
      const selectedTime = new Date(refreshAt)
      if (!refreshAt || Number.isNaN(selectedTime.getTime()) || selectedTime.getTime() <= Date.now()) {
        toast.error("Choose a future date and time for the category refresh.")
        return
      }
      scheduledFor = selectedTime.toISOString()
    }
    setBulkWorking(true)
    let queued = 0
    let failed = 0
    for (const row of eligible) {
      try {
        await api(`/api/categories/${encodeURIComponent(row.id || row.categoryId || "")}/apply-channel-to-products`, {
          method: "POST",
          body: JSON.stringify({
            scope: categoryScope,
            channel,
            background: true,
            force: true,
            updateExistingSkus: true,
            updateChannelRecords: true,
            createMarketplaceReview: refreshMarketplaceReview,
            scheduledFor,
          }),
        })
        queued += 1
      } catch {
        failed += 1
      }
    }
    setBulkWorking(false)
    setBulkRefreshOpen(false)
    setSelectedCategoryIds(new Set())
    if (queued) toast.success(`${numberLabel(queued)} category refresh jobs ${scheduledFor ? "scheduled" : "queued"}. Live listings are not changed.`)
    if (failed) toast.error(`${numberLabel(failed)} category refresh jobs could not be queued.`)
  }

  async function searchTaxonomy(channel: "shopify" | "ebay") {
    const value = channel === "shopify" ? shopifyQuery : ebayQuery
    if (!value.trim()) return
    setTaxonomyLoading(channel)
    if (channel === "ebay") {
      setEbaySearchMessage("")
      setEbaySearchWarning("")
    }
    try {
      const result = await api<{ categories?: CategoryChannelMapping[]; message?: string; warning?: string }>(`/api/channel-taxonomies/${channel}/categories?q=${encodeURIComponent(value)}&limit=12${channel === "ebay" ? "&live=0" : ""}`)
      channel === "shopify" ? setShopifyResults(result.categories || []) : setEbayResults(result.categories || [])
      if (channel === "ebay") {
        setEbaySearchMessage(result.message || "")
        setEbaySearchWarning(result.warning || "")
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to search ${channel} taxonomy.`)
    } finally {
      setTaxonomyLoading("")
    }
  }

  async function deleteProfile() {
    if (!profile || !profile.canDelete || !window.confirm(`Delete the saved profile for ${profile.name}?`)) return
    try {
      await api(`/api/categories/${encodeURIComponent(profile.id || profile.categoryId || "")}?scope=${categoryScope}`, { method: "DELETE", body: JSON.stringify({ scope: categoryScope }) })
      toast.success("Category profile deleted.")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete category profile.")
    }
  }

  const mapping = (channel: string) => profile?.mappings?.[channel] || {}
  const mappedChannels = ["shopify", "ebay", "temu", "tiktok", "whatnot"].filter((channel) => Boolean(profile?.mappings?.[channel]?.categoryId))
  const required = [...(profile?.requiredAttributes || []), ...[...mapping("shopify").attributes || [], ...mapping("ebay").attributes || []].filter((attribute) => attribute.required).map((attribute) => attribute.name || attribute.id || "")].filter(Boolean)

  useEffect(() => {
    if (!standalone) return
    const handleAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action
      if (action === "save") void saveOverview()
      if (action === "sync-attributes") void syncAttributes()
    }
    window.addEventListener("dataplus:category-action", handleAction)
    return () => window.removeEventListener("dataplus:category-action", handleAction)
  }, [standalone, profile])

  if (!standalone) {
    const clearFilters = () => {
      setQuery("")
      setMappingFilter("")
      setReviewFilter("")
      setConfidenceFilter("")
      setLifecycleFilter("")
      setMinimumProducts("")
      setChannelFilter("shopify")
      setPage(1)
      setSelectedCategoryIds(new Set())
    }
    const channel = channelFilter === "walmart" ? "walmart" : channelFilter === "ebay" ? "ebay" : "shopify"
    const summary = categorySummary?.[channel]
    const pageIds = categories.map((row) => row.id || row.categoryId || "").filter(Boolean)
    const allPageSelected = Boolean(pageIds.length) && pageIds.every((id) => selectedCategoryIds.has(id))
    const togglePage = (checked: boolean) => {
      setSelectedCategoryIds((current) => {
        const next = new Set(current)
        pageIds.forEach((id) => checked ? next.add(id) : next.delete(id))
        return next
      })
    }
    const toggleRow = (id: string, checked: boolean) => {
      setSelectedCategoryIds((current) => {
        const next = new Set(current)
        checked ? next.add(id) : next.delete(id)
        return next
      })
    }
    const summaryCards = [
      ["Mapped", summary?.mapped || 0, "border-emerald-500/30 bg-emerald-500/5"],
      ["Awaiting approval", summary?.["awaiting-review"] || 0, "border-amber-500/30 bg-amber-500/5"],
      ["Auto-applied", summary?.["auto-applied"] || 0, "border-blue-500/30 bg-blue-500/5"],
      ["Unmapped", summary?.unmapped || 0, "border-border bg-muted/20"],
    ] as const

    return <div className="grid gap-5">
      <PageHeader
        eyebrow="Catalog"
        title="Categories"
        description={categoryScope === "main" ? "Review internal categories and their Shopify / Google, eBay and Walmart mapping state." : "Review supplier source categories before promoting or mapping them."}
        action={<div className="flex flex-wrap gap-2">
          <div className="flex rounded-md border p-0.5">
            <Button size="sm" variant={categoryScope === "main" ? "secondary" : "ghost"} onClick={() => setCategoryScope("main")}>Main</Button>
            <Button size="sm" variant={categoryScope === "source" ? "secondary" : "ghost"} onClick={() => setCategoryScope("source")}>Source</Button>
          </div>
          {categoryScope === "main" && <Button size="sm" onClick={() => setAiReviewOpen(true)}><ShieldCheck className="size-4" /> Review all with David</Button>}
          {categoryScope === "main" && <Button size="sm" variant="outline" onClick={() => setEbayAutoMapOpen(true)}><Database className="size-4" /> Map all to eBay</Button>}
          <Button variant="outline" size="sm" asChild><a href="/api/categories/export/master-category-mapping.csv"><FileDown className="size-4" /> Export</a></Button>
          <Button variant="outline" size="sm" onClick={rebuildIndex} disabled={rebuilding}>{rebuilding ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Rebuild index</Button>
        </div>}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map(([label, value, tone]) => <Card key={label} className={tone}><CardContent className="p-4"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{numberLabel(value)}</p></CardContent></Card>)}
      </div>

      <Card>
        <CardHeader className="gap-4 border-b">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><CardTitle className="text-sm">Category mapping index</CardTitle><CardDescription>{numberLabel(totalCategories)} matching categories. Results are loaded from the stored category index.</CardDescription></div>
            <Badge variant="outline">{channel === "walmart" ? "Walmart" : channel === "shopify" ? "Shopify / Google" : "eBay"}</Badge>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_180px_180px_180px_160px_auto]">
            <div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />{loading && <Loader2 className="absolute right-2.5 top-2.5 size-4 animate-spin text-primary" />}<Input className="px-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Category, vendor, or brand" /></div>
            <Select value={channel} onValueChange={setChannelFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="shopify">Shopify / Google</SelectItem><SelectItem value="ebay">eBay</SelectItem><SelectItem value="walmart" disabled={categoryScope !== "main"}>Walmart</SelectItem></SelectContent></Select>
            <Select value={reviewFilter || "all"} onValueChange={(value) => setReviewFilter(value === "all" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any review state</SelectItem><SelectItem value="auto-applied">Auto-applied</SelectItem><SelectItem value="awaiting-review">Awaiting approval</SelectItem><SelectItem value="manual">Manual / approved</SelectItem><SelectItem value="unmapped">Unmapped</SelectItem></SelectContent></Select>
            <Select value={confidenceFilter || "all"} onValueChange={(value) => setConfidenceFilter(value === "all" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any confidence</SelectItem><SelectItem value="high">75% or higher</SelectItem><SelectItem value="medium">50% to 74%</SelectItem><SelectItem value="low">Below 50%</SelectItem><SelectItem value="none">No score</SelectItem></SelectContent></Select>
            <Select value={lifecycleFilter || "all"} onValueChange={(value) => setLifecycleFilter(value === "all" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any lifecycle</SelectItem><SelectItem value="new">New</SelectItem><SelectItem value="current">Current</SelectItem><SelectItem value="outdated">Outdated</SelectItem></SelectContent></Select>
            <Button variant="ghost" size="sm" onClick={clearFilters}>Clear</Button>
          </div>
          <div className="grid gap-2 md:grid-cols-[180px_180px_1fr]">
            <Select value={mappingFilter || "all"} onValueChange={(value) => setMappingFilter(value === "all" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any mapping</SelectItem><SelectItem value="mapped">Mapped on channel</SelectItem><SelectItem value="missing">Missing on channel</SelectItem><SelectItem value="fully-mapped">Shopify, collection, eBay mapped</SelectItem><SelectItem value="missing-shopify">Missing Shopify</SelectItem><SelectItem value="missing-collection">Missing collection</SelectItem><SelectItem value="missing-ebay">Missing eBay</SelectItem></SelectContent></Select>
            <Input type="number" min="0" value={minimumProducts} onChange={(event) => setMinimumProducts(event.target.value)} placeholder="Minimum products" />
            <p className="self-center text-xs text-muted-foreground">Confidence and approval filters apply to the selected channel. TikTok and Whatnot are excluded.</p>
          </div>
        </CardHeader>

        {approvalProgress && <div role="status" aria-live="polite" className="border-b px-4 py-3 text-sm"><p>{bulkWorking ? 'Saving approvals' : 'Approval run complete'}: {approvalProgress.done} / {approvalProgress.total}; {approvalProgress.approved} saved; {approvalProgress.errors.length} need attention.</p>{approvalProgress.errors.length > 0 && <details className="mt-2"><summary>Review failures</summary><ul className="mt-2 space-y-1 text-xs text-destructive">{approvalProgress.errors.map((error, index) => <li key={index} className="[overflow-wrap:anywhere]">{error}</li>)}</ul></details>}</div>}
        {selectedCategoryIds.size > 0 && <div className="flex flex-wrap items-center gap-2 border-b bg-primary/5 px-4 py-3">
          <span className="text-sm font-medium">{numberLabel(selectedCategoryIds.size)} selected</span>
          <Button size="sm" onClick={() => void approveSelectedSuggestions()} disabled={bulkWorking}>{bulkWorking ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Approve suggestions</Button>
          {channel !== "walmart" && <Button size="sm" variant="outline" onClick={() => { setRefreshTiming("now"); setRefreshAt(""); setBulkRefreshOpen(true) }} disabled={bulkWorking}><RefreshCw className="size-4" /> Refresh affected SKUs</Button>}
          <Button size="sm" variant="ghost" onClick={() => setSelectedCategoryIds(new Set())}>Clear</Button>
          <span className="text-xs text-muted-foreground">Refreshes DataPlus records only; live listings are not published or changed.</span>
        </div>}

        <CardContent className="p-0">
          {loading ? <div className="grid gap-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : categories.length === 0 ? <Empty className="py-12"><EmptyHeader><EmptyMedia variant="icon"><Search /></EmptyMedia><EmptyTitle>No categories found</EmptyTitle><EmptyDescription>Adjust the saved mapping filters or rebuild the category index.</EmptyDescription></EmptyHeader></Empty> : <div className="overflow-x-auto"><Table>
            <TableHeader><TableRow><TableHead className="w-10"><Checkbox disabled={bulkWorking} checked={allPageSelected} onCheckedChange={(checked) => togglePage(checked === true)} aria-label="Select this page" /></TableHead><TableHead>Category</TableHead><TableHead>Mapping state</TableHead><TableHead>Mapped category</TableHead><TableHead>Lifecycle</TableHead><TableHead className="text-right">Products</TableHead><TableHead className="w-24 text-right">Action</TableHead></TableRow></TableHeader>
            <TableBody>{categories.map((row) => {
              const id = row.id || row.categoryId || ""
              const channelMapping = row.mappings?.[channel]
              return <TableRow key={id} data-state={selectedCategoryIds.has(id) ? "selected" : undefined}>
                <TableCell><Checkbox disabled={bulkWorking} checked={selectedCategoryIds.has(id)} onCheckedChange={(checked) => toggleRow(id, checked === true)} aria-label={`Select ${row.name || id}`} /></TableCell>
                <TableCell className="min-w-64"><a className="text-left font-medium text-primary hover:underline" href={`/categories/${encodeURIComponent(id)}?scope=${categoryScope}&channel=${channel}`}>{row.name || id}</a><p className="mt-1 max-w-xl truncate text-xs text-muted-foreground">{row.topVendors?.slice(0, 3).map((item) => item.name).filter(Boolean).join(" · ") || "No supplier summary"}</p></TableCell>
                <TableCell><CategoryMappingBadge channel={channel} mapping={channelMapping} /></TableCell>
                <TableCell className="max-w-md"><p className="truncate text-sm">{channelMapping?.categoryPath || channelMapping?.pendingSuggestion?.categoryPath || "Not mapped"}</p>{channelMapping?.locked && <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><LockKeyhole className="size-3" /> Locked</p>}</TableCell>
                <TableCell><Badge variant="outline">{row.lifecycle || "current"}</Badge></TableCell>
                <TableCell className="text-right tabular-nums">{numberLabel(row.productCount || 0)}</TableCell>
                <TableCell className="text-right"><Button size="sm" variant="outline" asChild><a href={`/categories/${encodeURIComponent(id)}?scope=${categoryScope}&channel=${channel}`}>Open</a></Button></TableCell>
              </TableRow>
            })}</TableBody>
          </Table></div>}
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t p-3">
          <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Rows</span><Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}><SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger><SelectContent>{[25, 50, 100, 250].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent></Select></div>
          <p className="text-xs text-muted-foreground">Page {page} of {pageCount}</p>
          <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><Button size="sm" variant="outline" disabled={page >= pageCount || loading} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Next</Button></div>
        </CardFooter>
      </Card>

      <Dialog open={bulkRefreshOpen} onOpenChange={(open) => { if (!bulkWorking) setBulkRefreshOpen(open) }}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Refresh selected category products</DialogTitle><DialogDescription>Queue one tracked job for each selected {channel === "walmart" ? "Walmart" : channel === "shopify" ? "Shopify / Google" : "eBay"} category mapping. The jobs update DataPlus records only.</DialogDescription></DialogHeader><div className="grid gap-4 py-2"><Alert><ShieldCheck className="size-4" /><AlertTitle>No automatic marketplace changes</AlertTitle><AlertDescription>Products and live listings are not published or edited by this refresh.</AlertDescription></Alert><label className="flex cursor-pointer items-start gap-3 rounded-md border p-4"><Checkbox checked={refreshMarketplaceReview} onCheckedChange={(checked) => setRefreshMarketplaceReview(checked === true)} /><span><span className="block text-sm font-medium">Create marketplace follow-up review</span><span className="mt-1 block text-xs text-muted-foreground">After local records refresh, add a visible review-stage job for channel updates that a user may choose to run later.</span></span></label><div className="grid gap-3 rounded-md border p-4"><Label>When should these jobs run?</Label><div className="grid grid-cols-2 gap-2"><Button type="button" variant={refreshTiming === "now" ? "default" : "outline"} onClick={() => setRefreshTiming("now")}><RefreshCw className="size-4" /> Now</Button><Button type="button" variant={refreshTiming === "later" ? "default" : "outline"} onClick={() => setRefreshTiming("later")}><Clock3 className="size-4" /> Schedule</Button></div>{refreshTiming === "later" && <div className="grid gap-2"><Label htmlFor="bulk-category-refresh-time">Scheduled time</Label><Input id="bulk-category-refresh-time" type="datetime-local" value={refreshAt} min={new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)} onChange={(event) => setRefreshAt(event.target.value)} /></div>}</div></div><DialogFooter><Button variant="outline" onClick={() => setBulkRefreshOpen(false)} disabled={bulkWorking}>Cancel</Button><Button onClick={() => void refreshSelectedCategories()} disabled={bulkWorking}>{bulkWorking ? <Loader2 className="size-4 animate-spin" /> : refreshTiming === "later" ? <Clock3 className="size-4" /> : <RefreshCw className="size-4" />}{refreshTiming === "later" ? "Schedule jobs" : "Queue jobs"}</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={ebayAutoMapOpen} onOpenChange={setEbayAutoMapOpen}><DialogContent><DialogHeader><DialogTitle>Map all categories to eBay?</DialogTitle><DialogDescription>This runs in the background from the local eBay taxonomy cache. Matches at 75% confidence or higher are approved and locked; lower-confidence suggestions remain reviewable.</DialogDescription></DialogHeader><label className="flex items-start gap-3 rounded-md border p-4"><Checkbox checked={refreshAfterEbayAutoMap} onCheckedChange={(checked) => setRefreshAfterEbayAutoMap(checked === true)} /><span><span className="block text-sm font-medium">Refresh affected DataPlus SKU records</span><span className="mt-1 block text-xs text-muted-foreground">This does not publish or modify live eBay listings.</span></span></label><DialogFooter><Button variant="outline" onClick={() => setEbayAutoMapOpen(false)}>Cancel</Button><Button onClick={() => void queueEbayAutoMap()} disabled={ebayAutoMapping}>{ebayAutoMapping ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />} Start mapping job</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={aiReviewOpen} onOpenChange={setAiReviewOpen}><DialogContent><DialogHeader><DialogTitle>Review all category mappings with David?</DialogTitle><DialogDescription>David reviews Shopify / Google and eBay against their local taxonomy caches. High-confidence matches are approved; the rest remain suggestions.</DialogDescription></DialogHeader><div className="grid gap-3"><label className="flex items-center gap-3 rounded-md border p-3"><Checkbox checked={aiReviewChannels.includes("shopify")} onCheckedChange={(checked) => setAiReviewChannels((current) => checked ? Array.from(new Set([...current, "shopify"])) : current.filter((item) => item !== "shopify"))} /> Shopify / Google</label><label className="flex items-center gap-3 rounded-md border p-3"><Checkbox checked={aiReviewChannels.includes("ebay")} onCheckedChange={(checked) => setAiReviewChannels((current) => checked ? Array.from(new Set([...current, "ebay"])) : current.filter((item) => item !== "ebay"))} /> eBay</label><label className="flex items-start gap-3 rounded-md border p-3"><Checkbox checked={refreshPendingAi} onCheckedChange={(checked) => setRefreshPendingAi(checked === true)} /><span><span className="block text-sm font-medium">Re-review existing pending suggestions</span><span className="text-xs text-muted-foreground">Useful after taxonomy or model changes.</span></span></label></div><DialogFooter><Button variant="outline" onClick={() => setAiReviewOpen(false)}>Cancel</Button><Button onClick={() => void queueAiReview()} disabled={aiReviewing}>{aiReviewing ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Queue review</Button></DialogFooter></DialogContent></Dialog>
    </div>
  }

  if (false && !standalone) {
    const clearFilters = () => { setQuery(""); setMappingFilter(""); setReviewFilter(""); setConfidenceFilter(""); setLifecycleFilter(""); setMinimumProducts(""); setChannelFilter("shopify"); setPage(1); setSelectedCategoryIds(new Set()) }
    return <><div className="grid gap-5">
      <PageHeader eyebrow="Catalog" title="Categories" description={categoryScope === "main" ? "Main catalog categories, their lifecycle, product coverage, and channel mapping health." : "Supplier source categories. Review this scope before adding new main categories."} action={<div className="flex flex-wrap gap-2"><div className="flex rounded-md border p-0.5"><Button size="sm" variant={categoryScope === "main" ? "secondary" : "ghost"} onClick={() => setCategoryScope("main")}>Main</Button><Button size="sm" variant={categoryScope === "source" ? "secondary" : "ghost"} onClick={() => setCategoryScope("source")}>Source</Button></div>{categoryScope === "main" && <Button size="sm" onClick={() => setAiReviewOpen(true)}><ShieldCheck className="size-4" /> Review all with David</Button>}{categoryScope === "main" && <Button size="sm" variant="outline" onClick={() => setEbayAutoMapOpen(true)}><Database className="size-4" /> Map all to eBay</Button>}<Button variant="outline" size="sm" asChild><a href="/api/categories/export/master-category-mapping.csv"><FileDown className="size-4" /> Export categories</a></Button><Button variant="outline" size="sm" onClick={rebuildIndex} disabled={rebuilding}>{rebuilding ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Rebuild index</Button></div>} />
      <Card><CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[190px_190px_190px_minmax(180px,1fr)_auto]"><div className="grid gap-1"><Label className="text-xs">{channelFilter === "shopify" ? "Shopify / Google mapping" : `${channelFilter === "ebay" ? "eBay" : channelFilter} mapping`}</Label><Select value={reviewFilter || "all"} onValueChange={(value) => setReviewFilter(value === "all" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any mapping source</SelectItem><SelectItem value="auto-applied">Auto-applied</SelectItem><SelectItem value="awaiting-review">Awaiting approval</SelectItem><SelectItem value="manual">Manual / approved</SelectItem><SelectItem value="unmapped">Unmapped</SelectItem></SelectContent></Select></div><div className="grid gap-1"><Label className="text-xs">Channel confidence</Label><Select value={confidenceFilter || "all"} onValueChange={(value) => setConfidenceFilter(value === "all" ? "" : value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any confidence</SelectItem><SelectItem value="high">75% or higher</SelectItem><SelectItem value="medium">50% to 74%</SelectItem><SelectItem value="low">Below 50%</SelectItem><SelectItem value="none">No confidence score</SelectItem></SelectContent></Select></div><div className="grid gap-1"><Label className="text-xs">Minimum products</Label><Input type="number" min="0" value={minimumProducts} onChange={(event) => setMinimumProducts(event.target.value)} placeholder="0" /></div><div className="flex items-end"><p className="text-xs text-muted-foreground">Mapping source and confidence follow the channel selected in the category table filters below.</p></div><div className="flex items-end"><Button variant="ghost" size="sm" onClick={() => { setReviewFilter(""); setConfidenceFilter(""); setMinimumProducts("") }} disabled={!reviewFilter && !confidenceFilter && !minimumProducts}>Clear extra filters</Button></div></CardContent></Card>
      <Card><CardHeader className="gap-4 border-b"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-sm">Main category table</CardTitle><CardDescription>{numberLabel(visibleCategories.length)} shown / {numberLabel(categories.length)} loaded. Open a row for channel mappings and category rules.</CardDescription></div><Badge variant="outline">Main catalog</Badge></div><div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_160px_160px_160px_auto]"><div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Category, vendor, or brand" /></div><Select value={channelFilter} onValueChange={setChannelFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="shopify">Shopify</SelectItem><SelectItem value="ebay">eBay</SelectItem><SelectItem value="walmart" disabled={categoryScope !== "main"}>Walmart</SelectItem><SelectItem value="temu">Temu</SelectItem><SelectItem value="tiktok">TikTok</SelectItem><SelectItem value="whatnot">Whatnot</SelectItem></SelectContent></Select><Select value={mappingFilter || "all"} onValueChange={(value) => setMappingFilter(value === "all" ? "" : value)}><SelectTrigger><SelectValue placeholder="Any mapping" /></SelectTrigger><SelectContent><SelectItem value="all">Any mapping</SelectItem><SelectItem value="mapped">Mapped on selected channel</SelectItem><SelectItem value="missing">Missing on selected channel</SelectItem><SelectItem value="fully-mapped">100% mapped: Shopify, collection, eBay</SelectItem><SelectItem value="missing-shopify">Missing Shopify category</SelectItem><SelectItem value="missing-collection">Missing Shopify collection</SelectItem><SelectItem value="missing-ebay">Missing eBay category</SelectItem></SelectContent></Select><Select value={lifecycleFilter || "all"} onValueChange={(value) => setLifecycleFilter(value === "all" ? "" : value)}><SelectTrigger><SelectValue placeholder="Any lifecycle" /></SelectTrigger><SelectContent><SelectItem value="all">Any lifecycle</SelectItem><SelectItem value="new">New</SelectItem><SelectItem value="current">Current</SelectItem><SelectItem value="outdated">Outdated</SelectItem></SelectContent></Select><Button variant="ghost" size="sm" onClick={clearFilters} disabled={!query && !mappingFilter && !reviewFilter && !confidenceFilter && !lifecycleFilter && !minimumProducts && channelFilter === "shopify"}>Clear</Button></div></CardHeader><CardContent className="p-0">{loading ? <div className="grid gap-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Category</TableHead><TableHead>Status</TableHead><TableHead>Lifecycle</TableHead><TableHead>Created by</TableHead><TableHead>Created</TableHead><TableHead className="text-right">Products</TableHead><TableHead className="text-right">Active</TableHead><TableHead className="text-right">In stock</TableHead><TableHead>Channel confidence</TableHead><TableHead>Missing</TableHead><TableHead /></TableRow></TableHeader><TableBody>{visibleCategories.slice(0, 500).map((category) => { const id = category.id || category.categoryId || ""; return <TableRow key={id}><TableCell className="min-w-72"><a className="font-medium hover:underline" href={`/categories/${encodeURIComponent(id)}`}>{category.name}</a><p className="mt-1 truncate text-xs text-muted-foreground">{(category.topVendors || []).slice(0, 2).map((vendor) => vendor.name).filter(Boolean).join(" / ") || "No vendor data"}</p><div className="mt-2 grid gap-1 text-xs text-muted-foreground"><p><span className="font-medium text-foreground">Shopify:</span> {category.mappings?.shopify?.categoryPath || category.mappings?.shopify?.categoryId || "Not mapped"}</p><p><span className="font-medium text-foreground">Google taxonomy:</span> {category.mappings?.shopify?.googleCategory?.breadcrumb || category.mappings?.shopify?.googleCategory?.fullName || (category.mappings?.shopify?.googleCategory?.id ? `Google ${category.mappings?.shopify?.googleCategory?.id}` : "Not mapped")}</p><p><span className="font-medium text-foreground">Collection:</span> {category.mappings?.shopify?.collectionHandle || category.smartCollection?.handle || "Not mapped"}</p><p><span className="font-medium text-foreground">eBay:</span> {category.mappings?.ebay?.categoryPath || category.mappings?.ebay?.categoryId || "Not mapped"}</p></div></TableCell><TableCell><Badge variant={category.status === "approved" || category.status === "mapped" ? "default" : "outline"}>{category.status?.replace(/_/g, " ") || "needs review"}</Badge></TableCell><TableCell><Badge variant="outline">{category.lifecycle || "current"}</Badge></TableCell><TableCell className="whitespace-nowrap text-sm">{category.createdByLabel || "Manual"}</TableCell><TableCell className="whitespace-nowrap text-sm text-muted-foreground">{dateLabel(category.createdAt)}</TableCell><TableCell className="text-right">{numberLabel(category.productCount)}</TableCell><TableCell className="text-right">{numberLabel(category.activeProductCount)}</TableCell><TableCell className="text-right">{numberLabel(category.stockProductCount)}</TableCell><TableCell><div className="flex min-w-52 gap-3"><CategoryMappingBadge channel="shopify" mapping={category.mappings?.shopify} /><CategoryMappingBadge channel="ebay" mapping={category.mappings?.ebay} /></div></TableCell><TableCell><Badge variant={Number(category.missingMappings || 0) ? "destructive" : "outline"}>{Number(category.missingMappings || 0) ? `${numberLabel(category.missingMappings)} missing` : "Ready"}</Badge></TableCell><TableCell><Button asChild size="sm" variant="outline"><a href={`/categories/${encodeURIComponent(id)}`}>Open</a></Button></TableCell></TableRow>})}{!visibleCategories.length && <TableRow><TableCell colSpan={11} className="py-10 text-center text-sm text-muted-foreground">No categories match these filters.</TableCell></TableRow>}</TableBody></Table>{visibleCategories.length > 500 && <p className="border-t px-4 py-3 text-xs text-muted-foreground">Showing the first 500 matching categories. Use the filters to narrow results.</p>}</div>}</CardContent></Card>
    </div><Dialog open={ebayAutoMapOpen} onOpenChange={setEbayAutoMapOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Map all missing categories to eBay</DialogTitle><DialogDescription>DataPlus compares every unmapped main category with the locally cached eBay US taxonomy. Results are saved once, so opening Categories later does not repeat the search.</DialogDescription></DialogHeader><div className="grid gap-3 py-2"><Alert><ShieldCheck className="size-4" /><AlertTitle>Manual mappings are protected</AlertTitle><AlertDescription>Matches at 75% confidence or higher are applied and locked automatically. Lower-confidence matches are stored as suggestions for a user to approve later.</AlertDescription></Alert><div className="grid gap-3 sm:grid-cols-3"><Detail label="Scope" value={categoryScope === "main" ? "Main categories" : "Source categories"} /><Detail label="Marketplace" value="eBay US" /><Detail label="Approval" value="75% confidence" /></div><div className="flex items-start justify-between gap-4 rounded-md border bg-muted/30 p-3"><div><p className="text-sm font-medium">Refresh affected SKU records</p><p className="text-xs text-muted-foreground">After mapping, update local eBay category metadata for products under every auto-approved category. This does not publish or edit live eBay listings.</p></div><Switch checked={refreshAfterEbayAutoMap} onCheckedChange={setRefreshAfterEbayAutoMap} /></div><p className="text-xs text-muted-foreground">The resumable background job checkpoints progress and creates approved, review, and error files in Jobs.</p></div><DialogFooter><Button variant="outline" onClick={() => setEbayAutoMapOpen(false)} disabled={ebayAutoMapping}>Cancel</Button><Button onClick={() => void queueEbayAutoMap()} disabled={ebayAutoMapping}>{ebayAutoMapping ? <Loader2 className="size-4 animate-spin" /> : <Database className="size-4" />} Run mapping batch</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={aiReviewOpen} onOpenChange={setAiReviewOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Review all categories with David</DialogTitle><DialogDescription>Queue a background review of every unlocked main-category mapping. David compares each category against DataPlus's locally cached marketplace taxonomies.</DialogDescription></DialogHeader><div className="grid gap-4 py-2"><Alert><ShieldCheck className="size-4" /><AlertTitle>75% automatic approval by default</AlertTitle><AlertDescription>Suggestions at or above the confidence threshold in System Settings are saved and locked automatically. Lower-confidence suggestions remain available under the Awaiting AI approval filter.</AlertDescription></Alert><div className="grid gap-2"><div className="flex items-start justify-between gap-4 rounded-md border p-3"><div><p className="text-sm font-medium">Shopify / Google taxonomy</p><p className="text-xs text-muted-foreground">Review the shared Shopify and Google product taxonomy mapping.</p></div><Switch checked={aiReviewChannels.includes("shopify")} onCheckedChange={(checked) => setAiReviewChannels((current) => checked ? Array.from(new Set([...current, "shopify"])) : current.filter((channel) => channel !== "shopify"))} /></div><div className="flex items-start justify-between gap-4 rounded-md border p-3"><div><p className="text-sm font-medium">eBay taxonomy</p><p className="text-xs text-muted-foreground">Review eBay category matches using the locally stored eBay taxonomy.</p></div><Switch checked={aiReviewChannels.includes("ebay")} onCheckedChange={(checked) => setAiReviewChannels((current) => checked ? Array.from(new Set([...current, "ebay"])) : current.filter((channel) => channel !== "ebay"))} /></div><div className="flex items-start justify-between gap-4 rounded-md border p-3"><div><p className="text-sm font-medium">Re-review pending suggestions</p><p className="text-xs text-muted-foreground">Normally existing approval-queue results are skipped. Enable this after changing the AI model or taxonomy.</p></div><Switch checked={refreshPendingAi} onCheckedChange={setRefreshPendingAi} /></div></div><p className="text-xs text-muted-foreground">Locked mappings and approved manual mappings remain protected. Progress, errors, and CSV artifacts are available from Jobs.</p></div><DialogFooter><Button variant="outline" onClick={() => setAiReviewOpen(false)} disabled={aiReviewing}>Cancel</Button><Button onClick={() => void queueAiReview()} disabled={aiReviewing || !aiReviewChannels.length}>{aiReviewing ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} Queue background review</Button></DialogFooter></DialogContent></Dialog></>
  }

  return <div className="category-profile grid min-w-0 grid-cols-[minmax(0,1fr)] gap-5">
    <PageHeader eyebrow={standalone ? "Catalog / Categories" : "Catalog"} title={standalone ? (profile?.name || "Category") : "Categories"} description={standalone ? "Dedicated category profile for channel taxonomy, data requirements, defaults, and collection behavior." : "The authoritative product type, channel taxonomy, requirement, collection, and default-rule profile for every approved main category."} action={standalone ? <Button variant="outline" size="sm" asChild><a href="/categories">Back to categories</a></Button> : <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" asChild><a href="/api/categories/export/matrixify-smart-collections.csv"><FileDown className="size-4" /> Collections CSV</a></Button><Button variant="outline" size="sm" asChild><a href="/api/categories/export/master-category-mapping.csv"><FileDown className="size-4" /> Mappings CSV</a></Button><Button variant="outline" size="sm" onClick={rebuildIndex} disabled={rebuilding}>{rebuilding ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Rebuild index</Button></div>} />
    {lastCategoryRefresh && <Alert className="border-blue-500/40 bg-blue-500/5"><Clock3 className="size-4" /><AlertTitle>{lastCategoryRefresh.scheduledFor ? "Category refresh scheduled" : "Category refresh queued"}</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-2"><span>{lastCategoryRefresh.jobNumber ? `Job #${lastCategoryRefresh.jobNumber}` : "Background job"} will refresh the selected {lastCategoryRefresh.channel} category data{lastCategoryRefresh.scheduledFor ? ` at ${dateLabel(lastCategoryRefresh.scheduledFor)}` : " as soon as a worker is available"}.</span><Button size="sm" variant="outline" asChild><a href={lastCategoryRefresh.id ? `/jobs/${lastCategoryRefresh.id}` : "/jobs"}>View job</a></Button></AlertDescription></Alert>}
    {standalone && profile && profileTab === "lifecycle" && <CategoryMappingHistory profile={profile} />}
    <div className={standalone ? "grid gap-5" : "grid gap-5 xl:grid-cols-[minmax(280px,0.72fr)_minmax(0,1.8fr)]"}>
      {!standalone && <Card className="h-fit xl:sticky xl:top-4"><CardHeader className="gap-3 border-b pb-4"><div><CardTitle className="text-sm">Main category index</CardTitle><CardDescription>{numberLabel(categories.length)} categories. Search changes the list only; it never changes catalog data.</CardDescription></div><div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search categories" value={query} onChange={(event) => setQuery(event.target.value)} /></div></CardHeader><CardContent className="max-h-[calc(100vh-20rem)] overflow-y-auto p-2">{loading ? <div className="grid gap-2 p-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div> : visibleCategories.map((category) => { const id = category.id || category.categoryId || ""; const active = id === selectedId; return <button key={id} onClick={() => setSelectedId(id)} className={`grid w-full gap-1 rounded-md px-3 py-3 text-left transition-colors ${active ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}><div className="flex items-start justify-between gap-2"><span className="line-clamp-2 text-sm font-medium">{category.name}</span><Badge variant={active ? "secondary" : "outline"} className="shrink-0 text-[10px]">{numberLabel(category.productCount)}</Badge></div><div className={`flex items-center gap-2 text-xs ${active ? "text-primary-foreground/75" : "text-muted-foreground"}`}><span>{category.status?.replace(/_/g, " ")}</span><span>{numberLabel(category.mappingCount)} channel maps</span></div></button>})}{!loading && !visibleCategories.length && <p className="p-6 text-center text-sm text-muted-foreground">No categories match this search.</p>}</CardContent></Card>}
      <Card>{!profile ? <CardContent className="p-10 text-center text-sm text-muted-foreground">{loading ? "Loading category profile..." : "This category was not found."}</CardContent> : <><CardHeader className="gap-4 border-b"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="mb-2 flex flex-wrap items-center gap-2"><Badge>{profile.status?.replace(/_/g, " ") || "Needs review"}</Badge>{profile.lifecycle && <Badge variant="outline">{profile.lifecycle}</Badge>}<Badge variant="outline">{numberLabel(profile.productCount)} products</Badge>{(profileTab === "shopify" || profileTab === "ebay") && <Badge variant={mapping(profileTab).locked ? "secondary" : "outline"}>{mapping(profileTab).locked ? <LockKeyhole className="mr-1 size-3" /> : <UnlockKeyhole className="mr-1 size-3" />}{mapping(profileTab).locked ? `${profileTab} locked` : `${profileTab} unlocked`}</Badge>}{editing && <Badge className="bg-blue-600 text-white hover:bg-blue-600">Editing</Badge>}</div><CardTitle className="text-lg">{profile.name}</CardTitle><CardDescription className="mt-1">Main category and product type authority. Products inherit this profile, then each channel receives its mapped taxonomy and requirements.</CardDescription></div><div className="flex flex-wrap gap-2">{!standalone && <Button variant="outline" size="sm" asChild><a href={`/categories/${encodeURIComponent(profile.id || profile.categoryId || "")}`}>Open full profile</a></Button>}{["shopify", "ebay", "walmart"].includes(profileTab) ? null : editing ? <><Button variant="outline" size="sm" onClick={cancelEditing} disabled={saving}>Cancel</Button><Button size="sm" onClick={() => void saveActiveSection()} disabled={saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save changes</Button></> : <Button size="sm" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit category</Button>}</div></div>{!["shopify", "ebay", "walmart"].includes(profileTab) && <div className="grid gap-2 sm:grid-cols-3"><div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Active products</p><p className="mt-1 text-lg font-semibold">{numberLabel(profile.activeProductCount)}</p></div><div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">In stock</p><p className="mt-1 text-lg font-semibold">{numberLabel(profile.stockProductCount)}</p></div><div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Vendor paths mapped</p><p className="mt-1 text-lg font-semibold">{numberLabel(profile.sourceMappingCount)}</p></div></div>}</CardHeader>
        <CardContent className="p-0"><Tabs value={standalone ? profileTab : "overview"} onValueChange={setProfileTab}><div className={standalone ? "overflow-x-auto border-b px-4" : "hidden"}><TabsList className="h-12 min-w-max bg-transparent p-0"><TabsTrigger value="overview" className="text-xs">Overview</TabsTrigger><TabsTrigger value="shopify" className="gap-2 text-xs">Shopify<MappingIndicator channel="Shopify" mapped={Boolean(selected?.mappings?.shopify?.categoryId)} /></TabsTrigger><TabsTrigger value="ebay" className="gap-2 text-xs">eBay<MappingIndicator channel="eBay" mapped={Boolean(selected?.mappings?.ebay?.categoryId)} /></TabsTrigger>{categoryScope === "main" && <TabsTrigger value="walmart" className="gap-2 text-xs">Walmart<MappingIndicator channel="Walmart" mapped={Boolean(selected?.mappings?.walmart?.categoryId)} /></TabsTrigger>}<TabsTrigger value="attributes" className="text-xs">Attributes</TabsTrigger><TabsTrigger value="defaults" className="text-xs">Defaults</TabsTrigger><TabsTrigger value="collection" className="text-xs">Collection</TabsTrigger><TabsTrigger value="lifecycle" className="text-xs">Lifecycle</TabsTrigger></TabsList></div>
          <TabsContent value="overview" className="m-0 p-5"><CategoryMappingOverview mappings={selected?.mappings} /><div className="grid gap-5 lg:grid-cols-2"><section className="grid gap-4"><div className="grid gap-2"><Label>Status</Label><Select disabled={!editing} value={profile.status || "needs_review"} onValueChange={(value) => updateProfile({ status: value })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="needs_review">Needs review</SelectItem><SelectItem value="mapped">Mapped</SelectItem><SelectItem value="approved">Approved</SelectItem><SelectItem value="inactive">Inactive</SelectItem></SelectContent></Select></div><div className="grid gap-2"><Label>Category owner</Label><Input disabled={!editing} value={profile.owner || ""} onChange={(event) => updateProfile({ owner: event.target.value })} placeholder="Responsible team member" /></div><div className="grid gap-2"><Label>Internal notes</Label><Textarea disabled={!editing} value={profile.notes || ""} onChange={(event) => updateProfile({ notes: event.target.value })} placeholder="Why this category is configured this way" /></div>{!editing && <p className="text-xs text-muted-foreground">Select Edit category to change the status, owner, or notes.</p>}</section><section className="grid content-start gap-4 rounded-md border p-4"><div><p className="text-sm font-medium">Product type model</p><p className="mt-1 text-xs text-muted-foreground">This main category is the product type. There is no second editable product-type list to drift from the catalog hierarchy.</p></div><div className="rounded-md bg-muted/50 p-3"><p className="text-xs text-muted-foreground">Shopify product type</p><p className="mt-1 text-sm font-medium">{profile.smartCollection?.productType || profile.name}</p></div><div><p className="mb-2 text-xs text-muted-foreground">Mapped channels</p><div className="flex flex-wrap gap-2">{mappedChannels.length ? mappedChannels.map((channel) => <Badge key={channel} variant="outline">{channel}</Badge>) : <span className="text-sm text-muted-foreground">No channel taxonomies mapped yet.</span>}</div></div><div><p className="mb-2 text-xs text-muted-foreground">Required marketplace attributes</p><div className="flex flex-wrap gap-2">{required.length ? required.slice(0, 10).map((name) => <Badge key={name} variant="secondary">{name}</Badge>) : <span className="text-sm text-muted-foreground">Requirements will appear after mapping and synchronization.</span>}</div></div></section></div></TabsContent>
          <TabsContent value="walmart" className="m-0 min-w-0 p-4"><WalmartCategoryMapping key={profile.name} category={profile.name || ""} onSaved={() => void load()} /></TabsContent>
          {(["shopify", "ebay"] as const).map(channel => {
            const current = mapping(channel)
            const results = channel === "shopify" ? shopifyResults : ebayResults
            const label = channel === "shopify" ? "Shopify" : "eBay"
            const dirty = JSON.stringify(current) !== JSON.stringify(selected?.mappings?.[channel] || {})
            const taxonomyChanged = current.categoryId !== selected?.mappings?.[channel]?.categoryId
            return <TabsContent key={channel} value={channel} className="m-0 min-w-0 p-4">
              <CategoryMappingWorkspace channel={label} localCategory={profile.name || ""} categoryId={current.categoryId} categoryPath={current.categoryPath || current.categoryId || ""}
                savedId={selected?.mappings?.[channel]?.categoryId}
                onUnlock={() => setMappingLock(channel, false)}
                onTreeSelect={row => {
                  setChannelRequirements(value => ({ ...value, [channel]: [] }))
                  updateMapping(channel, { categoryId: row.id, categoryPath: row.path, taxonomyVersion: row.taxonomyVersion || "", ...(channel === "shopify" ? { categoryHandle: row.categoryHandle || "", googleCategory: row.googleCategory || null, attributes: [] } : {}) })
                }}
                review={<PendingCategorySuggestionCard profile={profile} channel={channel} onApplied={next => { applySavedMapping(channel, next); openCategoryRefresh(channel) }} />}
                dirty={dirty} locked={current.locked} busy={saving} searching={taxonomyLoading === channel}
                query={channel === "shopify" ? shopifyQuery : ebayQuery} onQuery={channel === "shopify" ? setShopifyQuery : setEbayQuery} onSearch={() => void searchTaxonomy(channel)}
                results={results.map(result => ({ id: result.categoryId || result.id || "", path: result.categoryPath || result.fullName || result.name || "" }))}
                onSelect={id => {
                  const result = results.find(row => (row.categoryId || row.id) === id)
                  if (!result) return
                  setChannelRequirements(value => ({ ...value, [channel]: [] }))
                  updateMapping(channel, { categoryId: id, categoryPath: result.categoryPath || result.fullName || result.name || id, taxonomyVersion: result.taxonomyVersion || "", ...(channel === "shopify" ? { categoryHandle: result.categoryHandle || result.handle || "", googleCategory: result.googleCategory || null, attributes: result.attributes || [] } : {}) })
                  if (channel === "shopify") setShopifyResults([]); else setEbayResults([])
                }}
                onDiscard={() => setProfile(value => value ? { ...value, mappings: { ...value.mappings, [channel]: { ...(selected?.mappings?.[channel] || {}) } } } : value)}
                onSave={() => void saveChannel(channel, false)} onSaveAndUpdate={() => void saveChannel(channel, true)}
                lastRefresh={current.lastRefreshAt ? dateLabel(current.lastRefreshAt) : undefined}
                notice={current.locked ? <p className="text-xs text-muted-foreground">Protected mapping. Unlock under Protection & review before selecting a replacement.</p> : channel === "ebay" && (ebaySearchMessage || ebaySearchWarning) ? <p role="status" className="text-xs text-amber-800 dark:text-amber-200">{ebaySearchMessage || ebaySearchWarning}</p> : undefined}>
                {channel === "shopify" && <section className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2"><Label>Collection handle</Label><Input value={current.collectionHandle || ""} onChange={event => updateMapping(channel, { collectionHandle: event.target.value })} /></div>
                  <div className="grid min-w-0 gap-2"><Label>Google category reference</Label><p className="text-xs [overflow-wrap:anywhere]">{current.googleCategory?.breadcrumb || current.googleCategory?.fullName || "Not mapped"}</p><ChannelCategoryPicker key={`google:${profile.name}`} channel="Google" localCategory={profile.name || ""} selectedId={current.googleCategory?.id} savedId={selected?.mappings?.shopify?.googleCategory?.id} disabled={saving} readOnly={current.locked} onUnlock={() => setMappingLock("shopify", false)} onSelect={row => updateMapping(channel, { googleCategory: { id: row.id, breadcrumb: row.path, fullName: row.path } })} /></div>
                </section>}
                <section className="min-w-0">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">Category requirements</h4><Button variant="outline" size="sm" onClick={() => void loadChannelRequirements(channel)} disabled={requirementsLoading[channel] || !current.categoryId || taxonomyChanged}><RefreshCw className={requirementsLoading[channel] ? "size-4 animate-spin" : "size-4"} /> Refresh requirements</Button></div>
                  {taxonomyChanged ? <p className="py-4 text-xs text-muted-foreground">Requirements available after saving the selected category.</p> : !current.categoryId ? <p className="py-4 text-xs text-muted-foreground">No category selected.</p> : requirementsLoading[channel] ? <Skeleton className="h-24" /> : <div className="min-w-0 overflow-x-auto"><CategoryRequirementsDataTable channel={channel} attributes={channelRequirements[channel] || current.attributes || []} mappings={current.attributeMappings || []} onChange={next => updateMapping(channel, { attributeMappings: next })} /></div>}
                </section>
                <details className="min-w-0 border-t pt-3"><summary className="cursor-pointer text-xs font-medium">Protection & review</summary><div className="mt-3 grid min-w-0 gap-3">
                  <CategoryMappingLockControl channel={channel} mapping={current} busy={saving} onChange={locked => setMappingLock(channel, locked)} />
                  <DavidCategoryReviewCard profile={profile} channel={channel} scope={categoryScope} onApplied={next => { applySavedMapping(channel, next); openCategoryRefresh(channel) }} />
                </div></details>
              </CategoryMappingWorkspace>
            </TabsContent>
          })}
          <TabsContent value="attributes" className="m-0 p-5"><div className="grid gap-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium">Marketplace requirements and source mapping</p><p className="text-xs text-muted-foreground">Synchronize mapped channel requirements, then define where each value comes from before products are exported.</p></div><Button variant="outline" size="sm" onClick={syncAttributes} disabled={saving}><RefreshCw className="size-4" /> Sync requirements</Button></div>{["shopify", "ebay"].map((channel) => { const attributes = channelRequirements[channel] || mapping(channel).attributes || []; const mappings = mapping(channel).attributeMappings || []; return <section key={channel} className="rounded-md border"><div className="flex items-center justify-between border-b px-4 py-3"><div><p className="text-sm font-medium capitalize">{channel}</p><p className="text-xs text-muted-foreground">{numberLabel(attributes.length)} requirements discovered</p></div><Badge variant="outline">{mapping(channel).categoryId ? "Mapped" : "Not mapped"}</Badge></div>{!mapping(channel).categoryId ? <p className="p-4 text-sm text-muted-foreground">Map the {channel} taxonomy first.</p> : !attributes.length ? <p className="p-4 text-sm text-muted-foreground">No synchronized requirements yet. Use Sync requirements after the category is saved.</p> : <div className="divide-y">{attributes.map((attribute) => { const existing = mappings.find((row) => (row.attributeId || row.id) === (attribute.id || attribute.name)); return <div key={attribute.id || attribute.name} className="grid gap-3 p-4 lg:grid-cols-[minmax(180px,0.8fr)_minmax(180px,1fr)_minmax(160px,0.8fr)]"><div><p className="text-sm font-medium">{attribute.name}</p><p className="text-xs text-muted-foreground">{attribute.required ? "Required" : attribute.recommended ? "Recommended" : "Optional"}{attribute.description ? ` | ${attribute.description}` : ""}</p></div><Input defaultValue={existing?.sourceField || ""} placeholder="Source field, e.g. brand" onBlur={(event) => { const next = [...mappings.filter((row) => (row.attributeId || row.id) !== (attribute.id || attribute.name)), { ...attribute, ...existing, attributeId: attribute.id || attribute.name, attributeName: attribute.name, sourceField: event.target.value, enabled: true }]; updateMapping(channel, { attributeMappings: next }) }} /><Input defaultValue={existing?.fallbackValue || ""} placeholder="Fallback value" onBlur={(event) => { const currentMappings = mapping(channel).attributeMappings || []; const next = [...currentMappings.filter((row) => (row.attributeId || row.id) !== (attribute.id || attribute.name)), { ...attribute, ...existing, attributeId: attribute.id || attribute.name, attributeName: attribute.name, fallbackValue: event.target.value, enabled: true }]; updateMapping(channel, { attributeMappings: next }) }} /></div>})}</div>}</section>})}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => saveChannel("ebay")} disabled={saving}>Save eBay attributes</Button><Button onClick={() => saveChannel("shopify")} disabled={saving}>Save Shopify attributes</Button></div></div></TabsContent>
          <TabsContent value="defaults" className="m-0 p-5"><div className="grid gap-5 lg:grid-cols-2"><div className="grid gap-2"><Label>Default condition</Label><Select value={profile.defaults?.condition || "New"} onValueChange={(value) => updateProfile({ defaults: { ...profile.defaults, condition: value } })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="New">New</SelectItem><SelectItem value="Used">Used</SelectItem><SelectItem value="Refurbished">Refurbished</SelectItem></SelectContent></Select></div><div className="grid gap-2"><Label>Country of origin</Label><Input value={profile.defaults?.countryOfOrigin || ""} onChange={(event) => updateProfile({ defaults: { ...profile.defaults, countryOfOrigin: event.target.value } })} placeholder="e.g. US" /></div><div className="grid gap-2"><Label>Default shipping profile</Label><Input value={profile.defaults?.shippingProfile || ""} onChange={(event) => updateProfile({ defaults: { ...profile.defaults, shippingProfile: event.target.value } })} placeholder="Used if a product has no override" /></div><div className="grid gap-2"><Label>Default return policy</Label><Input value={profile.defaults?.returnPolicy || ""} onChange={(event) => updateProfile({ defaults: { ...profile.defaults, returnPolicy: event.target.value } })} placeholder="Used if a product has no override" /></div><div className="flex items-start justify-between rounded-md border p-4"><div><p className="text-sm font-medium">Hazardous items allowed</p><p className="text-xs text-muted-foreground">Allows products in this category to carry hazardous flags.</p></div><Switch checked={Boolean(profile.defaults?.hazardousAllowed)} onCheckedChange={(checked) => updateProfile({ defaults: { ...profile.defaults, hazardousAllowed: checked } })} /></div><div className="flex items-start justify-between rounded-md border p-4"><div><p className="text-sm font-medium">Package weight required</p><p className="text-xs text-muted-foreground">Keeps products from passing readiness without shipping weight.</p></div><Switch checked={profile.defaults?.packageWeightRequired !== false} onCheckedChange={(checked) => updateProfile({ defaults: { ...profile.defaults, packageWeightRequired: checked } })} /></div></div><div className="flex justify-end"><Button onClick={() => save({ defaults: profile.defaults || {} })} disabled={saving}><Save className="size-4" /> Save defaults</Button></div></TabsContent>
          <TabsContent value="collection" className="m-0 p-5"><div className="grid gap-5"><div className="flex items-start justify-between rounded-md border p-4"><div><p className="text-sm font-medium">Smart collection profile</p><p className="text-xs text-muted-foreground">Used for export and collection automation. It is a channel behavior attached to this main category.</p></div><Switch checked={Boolean(profile.smartCollection?.enabled)} onCheckedChange={(checked) => updateProfile({ smartCollection: { ...profile.smartCollection, enabled: checked } })} /></div><div className="grid gap-4 lg:grid-cols-2"><div className="grid gap-2"><Label>Shopify product type</Label><Input value={profile.smartCollection?.productType || profile.name || ""} onChange={(event) => updateProfile({ smartCollection: { ...profile.smartCollection, productType: event.target.value } })} /></div><div className="grid gap-2"><Label>Collection title</Label><Input value={profile.smartCollection?.title || ""} onChange={(event) => updateProfile({ smartCollection: { ...profile.smartCollection, title: event.target.value } })} placeholder={profile.name} /></div><div className="grid gap-2"><Label>Collection handle</Label><Input value={profile.smartCollection?.handle || ""} onChange={(event) => updateProfile({ smartCollection: { ...profile.smartCollection, handle: event.target.value } })} placeholder="Generated when left empty" /></div><div className="grid gap-2"><Label>Sort order</Label><Input value={profile.smartCollection?.sortOrder || ""} onChange={(event) => updateProfile({ smartCollection: { ...profile.smartCollection, sortOrder: event.target.value } })} placeholder="Best Selling" /></div><div className="grid gap-2"><Label>SEO title</Label><Input value={profile.smartCollection?.titleTag || ""} onChange={(event) => updateProfile({ smartCollection: { ...profile.smartCollection, titleTag: event.target.value } })} /></div><div className="grid gap-2"><Label>SEO description</Label><Input value={profile.smartCollection?.descriptionTag || ""} onChange={(event) => updateProfile({ smartCollection: { ...profile.smartCollection, descriptionTag: event.target.value } })} /></div></div><div className="grid gap-2"><Label>Collection description</Label><Textarea value={profile.smartCollection?.bodyHtml || ""} onChange={(event) => updateProfile({ smartCollection: { ...profile.smartCollection, bodyHtml: event.target.value } })} /></div><div className="flex justify-end"><Button onClick={() => save({ smartCollection: profile.smartCollection || {} })} disabled={saving}><Save className="size-4" /> Save collection profile</Button></div></div></TabsContent>
          <TabsContent value="lifecycle" className="m-0 p-5"><div className="grid gap-5"><section className="rounded-md border p-4"><div className="flex items-start gap-3"><History className="mt-0.5 size-4 text-muted-foreground" /><div><p className="text-sm font-medium">Profile history</p><p className="mt-1 text-xs text-muted-foreground">Created by {profile.createdByLabel || "System"} on {dateLabel(profile.createdAt)}. Last saved by {profile.updatedBy || "System"} on {dateLabel(profile.updatedAt)}.</p></div></div></section><section className="rounded-md border border-destructive/30 p-4"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-medium">Delete saved category profile</p><p className="mt-1 text-xs text-muted-foreground">This removes only saved category settings. Categories with products or vendor mappings stay protected.</p>{profile.deleteBlockers?.length ? <ul className="mt-3 list-disc pl-4 text-xs text-muted-foreground">{profile.deleteBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : null}</div><Button variant="destructive" size="sm" disabled={!profile.canDelete} onClick={deleteProfile}><Trash2 className="size-4" /> Delete profile</Button></div></section></div></TabsContent>
        </Tabs></CardContent></>}</Card>{standalone && profile && profileTab === "attributes" && <Card><CardHeader className="border-b"><CardTitle className="text-sm">Channel requirement table</CardTitle><CardDescription>Dense, filterable channel requirements for this category. Edit source fields and fallbacks here, then save the matching channel mapping.</CardDescription></CardHeader><CardContent className="p-5"><Tabs defaultValue="shopify"><TabsList><TabsTrigger value="shopify">Shopify</TabsTrigger><TabsTrigger value="ebay">eBay</TabsTrigger></TabsList><TabsContent value="shopify" className="mt-4"><CategoryRequirementsDataTable channel="shopify" attributes={channelRequirements.shopify || mapping("shopify").attributes || []} mappings={mapping("shopify").attributeMappings || []} onChange={(next) => updateMapping("shopify", { attributeMappings: next })} /><div className="mt-4 flex justify-end"><Button onClick={() => saveChannel("shopify")} disabled={saving}><Save className="size-4" /> Save Shopify requirements</Button></div></TabsContent><TabsContent value="ebay" className="mt-4"><CategoryRequirementsDataTable channel="ebay" attributes={channelRequirements.ebay || mapping("ebay").attributes || []} mappings={mapping("ebay").attributeMappings || []} onChange={(next) => updateMapping("ebay", { attributeMappings: next })} /><div className="mt-4 flex justify-end"><Button onClick={() => saveChannel("ebay")} disabled={saving}><Save className="size-4" /> Save eBay requirements</Button></div></TabsContent></Tabs></CardContent></Card>}
    </div>
    <Dialog open={Boolean(categoryRefreshPrompt)} onOpenChange={(open) => { if (!open && !refreshSubmitting) setCategoryRefreshPrompt(null) }}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Refresh affected products?</DialogTitle><DialogDescription>The category mapping is saved. Choose whether DataPlus should now refresh the {numberLabel(categoryRefreshPrompt?.productCount || 0)} existing SKU records under <strong>{categoryRefreshPrompt?.categoryName}</strong>, or keep the mapping only and update later.</DialogDescription></DialogHeader><div className="grid gap-4 py-2"><Alert><Clock3 className="size-4" /><AlertTitle>Safe, job-backed update</AlertTitle><AlertDescription>This updates DataPlus records only. It does not publish products or change live Shopify or eBay listings.</AlertDescription></Alert><div className="grid gap-3 sm:grid-cols-2"><label className="flex cursor-pointer items-start gap-3 rounded-md border p-4"><Checkbox checked={refreshExistingSkus} onCheckedChange={(checked) => setRefreshExistingSkus(checked === true)} /><span><span className="block text-sm font-medium">Existing SKU records</span><span className="mt-1 block text-xs text-muted-foreground">Stamp affected products with the saved main-to-channel category mapping.</span></span></label><label className="flex cursor-pointer items-start gap-3 rounded-md border p-4"><Checkbox checked={refreshChannelRecords} onCheckedChange={(checked) => setRefreshChannelRecords(checked === true)} /><span><span className="block text-sm font-medium">DataPlus channel records</span><span className="mt-1 block text-xs text-muted-foreground">Refresh local {categoryRefreshPrompt?.channel} category metadata used for readiness and future launches.</span></span></label></div><div className="grid gap-3 rounded-md border p-4"><Label>When should it run?</Label><div className="grid grid-cols-2 gap-2"><Button type="button" variant={refreshTiming === "now" ? "default" : "outline"} onClick={() => setRefreshTiming("now")}><RefreshCw className="size-4" /> Now</Button><Button type="button" variant={refreshTiming === "later" ? "default" : "outline"} onClick={() => setRefreshTiming("later")}><Clock3 className="size-4" /> Schedule for later</Button></div>{refreshTiming === "later" && <div className="grid gap-2"><Label htmlFor="category-refresh-time">Scheduled time</Label><Input id="category-refresh-time" type="datetime-local" value={refreshAt} min={new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)} onChange={(event) => setRefreshAt(event.target.value)} /><p className="text-xs text-muted-foreground">The queued job remains visible in Jobs and runs at this local time.</p></div>}</div></div><DialogFooter className="gap-2 sm:justify-between"><Button variant="ghost" onClick={() => setCategoryRefreshPrompt(null)} disabled={refreshSubmitting}>Keep mapping only</Button><div className="flex gap-2"><Button variant="outline" onClick={() => setCategoryRefreshPrompt(null)} disabled={refreshSubmitting}>Cancel</Button><Button onClick={() => void queueCategoryRefresh()} disabled={refreshSubmitting || (!refreshExistingSkus && !refreshChannelRecords)}>{refreshSubmitting ? <Loader2 className="size-4 animate-spin" /> : refreshTiming === "later" ? <Clock3 className="size-4" /> : <RefreshCw className="size-4" />}{refreshTiming === "later" ? "Schedule refresh" : "Start refresh"}</Button></div></DialogFooter></DialogContent></Dialog>
  </div>
}

export function StandaloneCategoryPage() {
  const categoryId = decodeURIComponent(window.location.pathname.split("/").filter(Boolean).pop() || "")
  const scope = new URLSearchParams(window.location.search).get("scope") === "source" ? "source" : "main"
  return <CategoriesWorkspace categoryId={categoryId} initialScope={scope} standalone />
}

const catalogResourceConfig: Record<Exclude<CatalogWorkspaceTab, "products" | "source" | "review" | "changes" | "category-review" | "mappings" | "ebay-blockers" | "ebay-sync-warnings" | "attributes" | "groups" | "inventory" | "templates" | "categories">, { endpoint: string; title: string; description: string; rows: string; columns: Array<[string, string]> }> = {
  readiness: { endpoint: "/api/data-quality/products?limit=100", title: "Readiness", description: "Product readiness queue for missing content, dimensions, category, or marketplace requirements.", rows: "rows", columns: [["sku", "SKU"], ["title", "Product"], ["issues", "Missing or invalid"], ["channel", "Channel"], ["status", "Status"]] },
}

export function CatalogResourcePage({ tab }: { tab: Exclude<CatalogWorkspaceTab, "products" | "source" | "review" | "changes" | "category-review" | "mappings" | "ebay-blockers" | "ebay-sync-warnings" | "attributes" | "groups" | "inventory" | "templates" | "categories"> }) {
  const config = catalogResourceConfig[tab]
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  async function load(force = false) {
    force ? setRefreshing(true) : setLoading(true)
    try {
      const result = await api<Record<string, unknown>>(config.endpoint)
      const values = result[config.rows]
      setRows(Array.isArray(values) ? values as Array<Record<string, unknown>> : [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to load ${config.title.toLowerCase()}.`)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => { load() }, [tab])

  return <div className="grid gap-5"><PageHeader eyebrow="Catalog" title={config.title} description={config.description} action={<div className="flex gap-2"><Button variant="outline" onClick={() => load(true)} disabled={refreshing}>{refreshing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button></div>} /><Card><CardHeader className="border-b"><CardTitle className="text-sm">{numberLabel(rows.length)} loaded</CardTitle><CardDescription>Data loads only when this workspace is opened.</CardDescription></CardHeader><CardContent className="p-4">{loading ? <div className="grid gap-2"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : <CatalogRecordsTable rows={rows} columns={config.columns} empty={`No ${config.title.toLowerCase()} records are available.`} />}</CardContent></Card></div>
}



export function AttributesPage() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [loading, setLoading] = useState(true)
  const [channel, setChannel] = useState("all")
  const [query, setQuery] = useState("")
  async function load(nextChannel = channel) { setLoading(true); try { const params = new URLSearchParams(); if (nextChannel !== "all") params.set("channel", nextChannel); const result = await api<{ rows?: Array<Record<string, unknown>> }>(`/api/categories/attributes?${params}`); setRows(result.rows || []) } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load category attributes.") } finally { setLoading(false) } }
  useEffect(() => { void load() }, [])
  const filtered = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(query.toLowerCase()))
  const mapped = filtered.filter((row) => Boolean(row["Mapped Source Field"] || row["Fallback Value"])).length
  const required = filtered.filter((row) => String(row.Required) === "true").length
  return <div className="grid gap-5"><PageHeader eyebrow="Catalog" title="Attributes" description="Audit marketplace requirements across category profiles. Edit source mappings inside the owning category so channel rules remain attached to the product type." action={<Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button>} /><div className="grid gap-3 sm:grid-cols-3"><Detail label="Requirements" value={numberLabel(filtered.length)} /><Detail label="Mapped" value={numberLabel(mapped)} /><Detail label="Required" value={numberLabel(required)} /></div><Card><CardHeader className="gap-3 border-b"><div className="grid gap-2 md:grid-cols-[220px_minmax(220px,1fr)]"><Select value={channel} onValueChange={(next) => { setChannel(next); void load(next) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All channels</SelectItem><SelectItem value="shopify">Shopify</SelectItem><SelectItem value="ebay">eBay</SelectItem></SelectContent></Select><div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search category, attribute, or source field" /></div></div><CardDescription>Unmapped required fields block channel readiness. Use the category profile to set a source field or fallback value.</CardDescription></CardHeader><CardContent className="p-0">{loading ? <div className="grid gap-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Category</TableHead><TableHead>Channel</TableHead><TableHead>Attribute</TableHead><TableHead>Source field</TableHead><TableHead>Fallback</TableHead><TableHead>Required</TableHead><TableHead /></TableRow></TableHeader><TableBody>{filtered.map((row, index) => { const category = String(row["Main Category"] || row.Category || row.category || ""); return <TableRow key={`${category}-${row.Attribute}-${index}`}><TableCell className="max-w-72 truncate font-medium">{category}</TableCell><TableCell><Badge variant="outline">{String(row["Marketplace"] || row.Channel || "-")}</Badge></TableCell><TableCell>{String(row.Attribute || "-")}</TableCell><TableCell>{String(row["Mapped Source Field"] || "-")}</TableCell><TableCell>{String(row["Fallback Value"] || "-")}</TableCell><TableCell><Badge variant={String(row.Required) === "true" ? "default" : "secondary"}>{String(row.Required) === "true" ? "Required" : "Optional"}</Badge></TableCell><TableCell><Button size="sm" variant="outline" asChild><a href={`/categories/${encodeURIComponent(String(row["Category ID"] || row.CategoryId || row.categoryId || category))}`}>Open category</a></Button></TableCell></TableRow>})}{!filtered.length && <TableRow><TableCell colSpan={7} className="h-28 text-center text-muted-foreground">No category requirements match.</TableCell></TableRow>}</TableBody></Table></div>}</CardContent></Card></div>
}

export function ImportReviewPage() {
  const [reviews, setReviews] = useState<CatalogImportReview[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState("")
  const [fieldFilter, setFieldFilter] = useState("all")

  async function load() {
    setLoading(true)
    try {
      const result = await api<{ reviews?: CatalogImportReview[] }>("/api/catalog-import-reviews")
      setReviews(result.reviews || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load protected import changes.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const pending = reviews.filter((review) => review.status === "pending")
  const decided = reviews.filter((review) => review.status !== "pending").slice(0, 50)
  const fields = [...new Set(pending.map((review) => review.label || review.field || "Unknown"))].sort()
  const filtered = pending.filter((review) => {
    const haystack = [review.sku, review.field, review.label, review.currentValue, review.incomingValue, review.source].join(" ").toLowerCase()
    return (!query.trim() || haystack.includes(query.trim().toLowerCase())) && (fieldFilter === "all" || (review.label || review.field || "Unknown") === fieldFilter)
  })
  const productCount = new Set(pending.map((review) => review.sku).filter(Boolean)).size
  const fieldCounts = pending.reduce<Record<string, number>>((result, review) => { const field = review.label || review.field || "Unknown"; result[field] = (result[field] || 0) + 1; return result }, {})
  const topField = Object.entries(fieldCounts).sort(([, left], [, right]) => right - left)[0]?.[0] || "None"

  async function decide(ids: string[], action: "accept" | "reject") {
    if (!ids.length) return
    const verb = action === "accept" ? "Accept" : "Reject"
    if (!window.confirm(`${verb} ${numberLabel(ids.length)} protected catalog change${ids.length === 1 ? "" : "s"}?`)) return
    setBusy(true)
    try {
      if (ids.length === 1) await api(`/api/catalog-import-reviews/${encodeURIComponent(ids[0])}/${action}`, { method: "POST", body: JSON.stringify({}) })
      else await api("/api/catalog-import-reviews/bulk", { method: "POST", body: JSON.stringify({ action, ids }) })
      toast.success(`${numberLabel(ids.length)} change${ids.length === 1 ? "" : "s"} ${action === "accept" ? "accepted" : "rejected"}.`)
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Unable to ${action} protected changes.`)
    } finally {
      setBusy(false)
    }
  }

  return <div className="grid gap-5">
    <PageHeader eyebrow="Catalog" title="Import Review" description="Protected source changes wait here until you accept or reject the incoming value." action={<div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void decide(pending.map((review) => review.id), "reject")} disabled={!pending.length || busy}>Reject all pending</Button><Button size="sm" onClick={() => void decide(pending.map((review) => review.id), "accept")} disabled={!pending.length || busy}>{busy && <Loader2 className="size-4 animate-spin" />} Accept all pending</Button></div>} />
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Detail label="Pending changes" value={numberLabel(pending.length)} /><Detail label="Products affected" value={numberLabel(productCount)} /><Detail label="Most changed field" value={topField} /><Detail label="Recent decisions" value={numberLabel(decided.length)} /></div>
    <Card><CardHeader className="gap-4 border-b"><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle className="text-sm">Pending protected changes</CardTitle><CardDescription>Accept writes the incoming value to the approved product. Reject preserves the current catalog value.</CardDescription></div><Button size="sm" variant="outline" onClick={() => void load()} disabled={loading || busy}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button></div><div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_220px]"><div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search SKU, field, source, or value" /></div><Select value={fieldFilter} onValueChange={setFieldFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All changed fields</SelectItem>{fields.map((field) => <SelectItem key={field} value={field}>{field} ({fieldCounts[field]})</SelectItem>)}</SelectContent></Select></div></CardHeader><CardContent className="p-0">{loading ? <div className="grid gap-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Field</TableHead><TableHead>Current DataPlus value</TableHead><TableHead>Incoming dump value</TableHead><TableHead>Source</TableHead><TableHead>Updated</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{filtered.slice(0, 300).map((review) => { const unmappedEbay = review.field === "ebayCatalogMatch" && !review.productId; return <TableRow key={review.id}><TableCell><a className="font-medium hover:underline" href={`/products/${encodeURIComponent(review.sku || "")}`}>{review.sku || "Unknown SKU"}</a></TableCell><TableCell className="font-medium">{review.label || review.field || "Unknown"}</TableCell><TableCell className="max-w-64"><p className="line-clamp-2">{String(review.currentValue ?? "-")}</p>{review.details && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{review.details}</p>}</TableCell><TableCell className="max-w-64"><p className="line-clamp-2">{String(review.incomingValue ?? "-")}</p>{review.externalUrl && <a className="mt-1 inline-block text-xs text-primary hover:underline" href={review.externalUrl} target="_blank" rel="noreferrer">Open source listing</a>}</TableCell><TableCell>{review.source || "Product dump"}</TableCell><TableCell className="whitespace-nowrap text-sm text-muted-foreground">{dateLabel(review.updatedAt)}</TableCell><TableCell><div className="flex justify-end gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void decide([review.id], "reject")}>Reject</Button><Button size="sm" disabled={busy || unmappedEbay} onClick={() => void decide([review.id], "accept")}>{unmappedEbay ? "Needs mapping" : "Accept"}</Button></div></TableCell></TableRow>})}{!filtered.length && <TableRow><TableCell colSpan={7} className="h-28 text-center text-muted-foreground">No pending protected changes match these filters.</TableCell></TableRow>}</TableBody></Table></div>}</CardContent></Card>
    {decided.length ? <Card><CardHeader className="border-b"><CardTitle className="text-sm">Recent decisions</CardTitle><CardDescription>Last 50 accepted or rejected import changes.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Field</TableHead><TableHead>Decision</TableHead><TableHead>Incoming value</TableHead><TableHead>Decided</TableHead></TableRow></TableHeader><TableBody>{decided.map((review) => <TableRow key={review.id}><TableCell>{review.sku || "-"}</TableCell><TableCell>{review.label || review.field || "-"}</TableCell><TableCell><Badge variant={review.status === "accepted" ? "default" : "secondary"}>{review.status || "resolved"}</Badge></TableCell><TableCell className="max-w-80 truncate">{String(review.incomingValue ?? "-")}</TableCell><TableCell>{dateLabel(review.decidedAt)}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card> : null}
  </div>
}

export function CategoryReviewPage() {
  const [rows, setRows] = useState<CategoryReviewRow[]>([])
  const [summary, setSummary] = useState<CategoryReviewResponse["summary"]>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [busy, setBusy] = useState(false)
  const [decisionStatus, setDecisionStatus] = useState<{ state: "running" | "done" | "error"; message: string } | null>(null)
  const [query, setQuery] = useState("")
  const [channel, setChannel] = useState<"shopify" | "ebay">("ebay")
  const [status, setStatus] = useState("pending")
  const [confidence, setConfidence] = useState("all")
  const [sort, setSort] = useState("confidence-desc")
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [total, setTotal] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [allFiltered, setAllFiltered] = useState(false)
  const [showCategoryStats, setShowCategoryStats] = useState(false)
  const [manualMappingPrompt, setManualMappingPrompt] = useState<{ row: CategoryReviewRow; mapping: CategoryChannelMapping } | null>(null)
  type CategoryReviewDecisionAction = "approve" | "deny" | "block" | "unmatch"
  const [pendingCategoryDecisions, setPendingCategoryDecisions] = useState<Record<string, { action: CategoryReviewDecisionAction; mapping?: CategoryChannelMapping; label: string }>>({})
  const [columnWidths, setColumnWidths] = useState({
    select: 48,
    local: 520,
    channel: 760,
    status: 130,
    action: 160,
  })
  const [refreshPrompt, setRefreshPrompt] = useState<{ ids: string[]; categoryName?: string; count: number; allFiltered?: boolean } | null>(null)
  const [refreshTiming, setRefreshTiming] = useState<"now" | "later">("now")
  const [refreshAt, setRefreshAt] = useState("")
  const limit = 100
  const selectedCount = allFiltered ? total : selected.size
  const selectedIds = [...selected]

  async function load(nextPage = page) {
    setLoading(true)
    setLoadError("")
    try {
      const params = new URLSearchParams({ channel, scope: "main", status, page: String(nextPage), limit: String(limit) })
      params.set("_", String(Date.now()))
      if (query.trim()) params.set("q", query.trim())
      if (confidence !== "all") params.set("confidence", confidence)
      params.set("sort", sort)
      const result = await api<CategoryReviewResponse>(`/api/categories/channel-review?${params}`)
      setRows(result.rows || [])
      setSummary(result.summary || {})
      setPage(Number(result.page || nextPage))
      setPageCount(Number(result.pageCount || 1))
      setTotal(Number(result.total || result.rows?.length || 0))
      setSelected(new Set())
      setAllFiltered(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load category review."
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load(1) }, [channel, status, confidence, sort])

  function rowId(row: CategoryReviewRow) {
    return String(row.id || row.categoryId || row.name || "")
  }

  const sortedRows = useMemo(() => {
    const confidenceValue = (row: CategoryReviewRow) => Number(row.confidence ?? row.pendingSuggestion?.confidence ?? row.mapping?.confidence ?? -1)
    return [...rows].sort((left, right) => {
      const nameSort = String(left.name || "").localeCompare(String(right.name || ""))
      const productSort = Number(right.productCount || 0) - Number(left.productCount || 0)
      const confidenceSort = confidenceValue(right) - confidenceValue(left)
      if (sort === "name-asc") return nameSort || productSort || confidenceSort
      if (sort === "product-desc") return productSort || confidenceSort || nameSort
      return confidenceSort || productSort || nameSort
    })
  }, [rows, sort])

  function toggleRow(id: string, checked: boolean) {
    setAllFiltered(false)
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function requestPayload(extra: Record<string, unknown> = {}) {
    return {
      channel,
      scope: "main",
      ids: selectedIds,
      allFiltered,
      q: query,
      status,
      confidence: confidence === "all" ? "" : confidence,
      ...extra,
    }
  }

  function categoryReviewDecisionLabel(action: CategoryReviewDecisionAction) {
    if (action === "approve") return "approve"
    if (action === "deny") return "deny"
    if (action === "block") return "block"
    return "mark as unmatched"
  }

  function stageCategoryDecision(row: CategoryReviewRow, action: CategoryReviewDecisionAction, mapping?: CategoryChannelMapping) {
    const id = rowId(row)
    if (!id) return
    if (action === "approve" && !mapping?.categoryId && !row.pendingSuggestion?.categoryId && !row.mapping?.categoryId) {
      toast.error("Search and choose a channel category before approving this row.")
      return
    }
    setPendingCategoryDecisions((current) => ({
      ...current,
      [id]: { action, mapping, label: row.name || id },
    }))
    const verb = categoryReviewDecisionLabel(action)
    setDecisionStatus({ state: "done", message: `Marked "${row.name || id}" to ${verb}. Use Save when you are ready to apply changes.` })
  }

  function stageSelectedDecision(action: CategoryReviewDecisionAction) {
    const targets = sortedRows.filter((row) => allFiltered || selected.has(rowId(row)))
    if (!targets.length) return toast.error("Select categories first.")
    let staged = 0
    setPendingCategoryDecisions((current) => {
      const next = { ...current }
      targets.forEach((row) => {
        const id = rowId(row)
        if (!id) return
        if (action === "approve" && !row.pendingSuggestion?.categoryId && !row.mapping?.categoryId) return
        next[id] = { action, label: row.name || id }
        staged += 1
      })
      return next
    })
    if (!staged) return toast.error("None of the selected rows have a category suggestion to approve.")
    setSelected(new Set())
    setAllFiltered(false)
    const verb = categoryReviewDecisionLabel(action)
    setDecisionStatus({ state: "done", message: `Marked ${numberLabel(staged)} visible categor${staged === 1 ? "y" : "ies"} to ${verb}. Use Save when you are ready to apply changes.` })
  }

  async function savePendingCategoryDecisions(updateAfter = false) {
    const entries = Object.entries(pendingCategoryDecisions)
    if (!entries.length) return toast.error("Mark one or more category decisions first.")
    setBusy(true)
    setDecisionStatus({ state: "running", message: `Saving ${numberLabel(entries.length)} category decision${entries.length === 1 ? "" : "s"}...` })
    try {
      let changed = 0
      const approvedIds: string[] = []
      const grouped: Record<CategoryReviewDecisionAction, string[]> = { approve: [], deny: [], block: [], unmatch: [] }
      const manualEntries: Array<[string, { action: CategoryReviewDecisionAction; mapping?: CategoryChannelMapping; label: string }]> = []
      entries.forEach(([id, decision]) => {
        if (decision.mapping) manualEntries.push([id, decision])
        else grouped[decision.action].push(id)
        if (decision.action === "approve") approvedIds.push(id)
      })
      for (const action of ["approve", "deny", "block", "unmatch"] as const) {
        const ids = grouped[action]
        if (!ids.length) continue
        const result = await api<{ changed?: number; message?: string }>("/api/categories/channel-review/decision", {
          method: "POST",
          body: JSON.stringify(requestPayload({ action, ids, allFiltered: false, note: action === "block" ? "Do not sell this category on this channel." : "" })),
        })
        changed += Number(result.changed || ids.length)
      }
      for (const [id, decision] of manualEntries) {
        const result = await api<{ changed?: number; message?: string }>("/api/categories/channel-review/decision", {
          method: "POST",
          body: JSON.stringify(requestPayload({ action: decision.action, ids: [id], allFiltered: false, mapping: decision.mapping, note: decision.action === "block" ? "Do not sell this category on this channel." : "" })),
        })
        changed += Number(result.changed || 1)
      }
      let refreshMessage = ""
      if (updateAfter && approvedIds.length) {
        const refresh = await api<{ job?: ImportJob; message?: string }>("/api/categories/channel-review/refresh-products", {
          method: "POST",
          body: JSON.stringify(requestPayload({ ids: approvedIds, allFiltered: false, status: "mapped", updateExistingSkus: true, updateChannelRecords: true })),
        })
        refreshMessage = refresh.job?.id ? ` SKU refresh queued as job ${refresh.job.id}.` : ` ${refresh.message || "SKU refresh queued."}`
      }
      const finalMessage = `Saved ${numberLabel(changed || entries.length)} category decision${(changed || entries.length) === 1 ? "" : "s"}.${refreshMessage}`
      toast.success(finalMessage)
      setPendingCategoryDecisions({})
      setSelected(new Set())
      setAllFiltered(false)
      await load(1)
      setDecisionStatus({ state: "done", message: `${finalMessage} Review list refreshed.` })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save category decisions."
      setDecisionStatus({ state: "error", message })
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  async function refreshSkus(ids?: string[], scheduledFor = "") {
    const count = ids?.length || selectedCount
    if (!count) return toast.error("Select approved mappings to refresh.")
    setBusy(true)
    try {
      const result = await api<{ job?: ImportJob; message?: string }>("/api/categories/channel-review/refresh-products", {
        method: "POST",
        body: JSON.stringify(requestPayload({ ids: ids || selectedIds, allFiltered: refreshPrompt?.allFiltered || (!ids && allFiltered), status: "mapped", updateExistingSkus: true, updateChannelRecords: true, scheduledFor })),
      })
      toast.success(result.message || "Category SKU refresh queued.")
      setRefreshPrompt(null)
      if (result.job?.id && !scheduledFor) window.setTimeout(() => { window.history.pushState({}, "", `/jobs/${encodeURIComponent(result.job!.id)}`); window.dispatchEvent(new PopStateEvent("popstate")) }, 600)
      await load(page)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue SKU refresh.")
    } finally {
      setBusy(false)
    }
  }

  function openRefresh(ids: string[], categoryName?: string, useAllFiltered = false) {
    setRefreshPrompt({ ids, categoryName, count: useAllFiltered ? total : ids.length, allFiltered: useAllFiltered })
    setRefreshTiming("now")
    setRefreshAt("")
  }

  function startRefreshPrompt() {
    if (!refreshPrompt) return
    const scheduledFor = refreshTiming === "later" && refreshAt ? new Date(refreshAt).toISOString() : ""
    void refreshSkus(refreshPrompt.ids, scheduledFor)
  }

  const pageIds = sortedRows.map(rowId).filter(Boolean)
  const pageSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const selectedMappedIds = allFiltered ? [] : sortedRows.filter((row) => selected.has(rowId(row)) && row.mapping?.categoryId).map(rowId)
  const pendingDecisionCount = Object.keys(pendingCategoryDecisions).length
  const actionHint = "Mark decisions first, then Save to apply them. Save and update also queues a local SKU/category metadata refresh."
  const defaultCategoryReviewColumnWidths = { select: 48, local: 520, channel: 760, status: 130, action: 160 }
  type CategoryReviewResizableColumn = "local" | "channel" | "status" | "action"
  const columnMinimums: Record<CategoryReviewResizableColumn, number> = { local: 280, channel: 420, status: 110, action: 130 }
  const tableWidth = Object.values(columnWidths).reduce((sum, width) => sum + width, 0)
  function startColumnResize(column: CategoryReviewResizableColumn, event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = columnWidths[column]
    const previousCursor = document.body.style.cursor
    document.body.style.cursor = "col-resize"
    const onMove = (moveEvent: globalThis.MouseEvent) => {
      const nextWidth = Math.max(columnMinimums[column], Math.round(startWidth + moveEvent.clientX - startX))
      setColumnWidths((current) => ({ ...current, [column]: nextWidth }))
    }
    const onUp = () => {
      document.body.style.cursor = previousCursor
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mouseup", onUp)
    }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }
  function resizableHeader(label: string, column: CategoryReviewResizableColumn, className = "") {
    return <TableHead style={{ width: columnWidths[column] }} className={cn("relative select-none pr-4", className)}><span>{label}</span><button type="button" aria-label={`Resize ${label} column`} className="absolute right-0 top-0 h-full w-2 cursor-col-resize border-r border-transparent hover:border-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary" onMouseDown={(event) => startColumnResize(column, event)} /></TableHead>
  }

  return <div className="grid gap-5">
    <PageHeader eyebrow="Catalog" title="Category Review" description="Review each channel taxonomy queue, search cached categories, approve or deny suggestions, block categories from sale, and schedule SKU refresh jobs." action={<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => void load()} disabled={loading || busy}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button><Button size="sm" onClick={() => void savePendingCategoryDecisions(false)} disabled={!pendingDecisionCount || busy}><CheckCircle2 className="size-4" /> Save</Button><Button size="sm" variant="outline" onClick={() => void savePendingCategoryDecisions(true)} disabled={!pendingDecisionCount || busy}>Save and update</Button></div>} />
    {loadError ? <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">Category review failed to load: {loadError}</div> : null}
    {decisionStatus ? <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${decisionStatus.state === "error" ? "border-destructive/30 bg-destructive/10 text-destructive" : decisionStatus.state === "done" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-primary/30 bg-primary/10 text-primary"}`}>{decisionStatus.state === "running" ? <Loader2 className="size-4 animate-spin" /> : decisionStatus.state === "done" ? <CheckCircle2 className="size-4" /> : null}<span>{decisionStatus.message}</span>{decisionStatus.state !== "running" ? <Button size="sm" variant="ghost" className="ml-auto h-7 px-2" onClick={() => setDecisionStatus(null)}>Dismiss</Button> : null}</div> : null}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><Detail label="Needs review" value={numberLabel(summary?.pending || 0)} /><Detail label="Approved" value={numberLabel(summary?.mapped || 0)} /><Detail label="Unmatched" value={numberLabel(summary?.missing || 0)} /><Detail label="Denied" value={numberLabel(summary?.denied || 0)} /><Detail label="Blocked" value={numberLabel(summary?.blocked || 0)} /><Detail label="Mapped products" value={numberLabel(summary?.mappedProducts || 0)} /></div>
    <Card>
      <CardHeader className="gap-4 border-b">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-sm">{channel === "ebay" ? "eBay" : "Shopify"} category review</CardTitle><CardDescription>{actionHint}</CardDescription></div>{selectedCount ? <Badge variant="secondary">{numberLabel(selectedCount)} selected</Badge> : null}</div>
        <div className="grid gap-2 md:grid-cols-[160px_170px_160px_190px_minmax(220px,1fr)_auto]">
          <Select value={channel} onValueChange={(value) => setChannel(value as "shopify" | "ebay")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ebay">eBay</SelectItem><SelectItem value="shopify">Shopify / Google</SelectItem></SelectContent></Select>
          <Select value={status} onValueChange={setStatus}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="pending">Needs review</SelectItem><SelectItem value="mapped">Approved</SelectItem><SelectItem value="missing">Unmatched</SelectItem><SelectItem value="denied">Denied</SelectItem><SelectItem value="blocked">Blocked</SelectItem><SelectItem value="all">All categories</SelectItem></SelectContent></Select>
          <Select value={confidence} onValueChange={setConfidence}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any confidence</SelectItem><SelectItem value="high">75%+</SelectItem><SelectItem value="medium">50-74%</SelectItem><SelectItem value="low">Below 50%</SelectItem><SelectItem value="none">No score</SelectItem></SelectContent></Select>
          <Select value={sort} onValueChange={setSort}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="confidence-desc">Confidence high to low</SelectItem><SelectItem value="product-desc">SKU count high to low</SelectItem><SelectItem value="name-asc">A-Z category</SelectItem></SelectContent></Select>
          <div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void load(1)} placeholder="Search local or channel category" /></div>
          <Button onClick={() => void load(1)} disabled={loading}>Search</Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2 text-sm">
          <div className="flex flex-wrap items-center gap-3"><label className="flex items-center gap-2"><Checkbox checked={pageSelected || allFiltered} onCheckedChange={(checked) => { const next = checked === true; setAllFiltered(false); setSelected(next ? new Set(pageIds) : new Set()) }} /> Select page</label><Button size="sm" variant={allFiltered ? "secondary" : "outline"} disabled={!total} onClick={() => { setAllFiltered(true); setSelected(new Set()) }}>Select all filtered ({numberLabel(total)})</Button><label className="flex items-center gap-2 text-muted-foreground"><Checkbox checked={showCategoryStats} onCheckedChange={(checked) => setShowCategoryStats(checked === true)} /> Show SKU counts</label><Button size="sm" variant="ghost" onClick={() => setColumnWidths(defaultCategoryReviewColumnWidths)}>Reset widths</Button></div>
          <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!selectedCount || busy || status !== "pending"} onClick={() => stageSelectedDecision("approve")}>Mark approve</Button><Button size="sm" variant="outline" disabled={!selectedCount || busy} onClick={() => stageSelectedDecision("deny")}>Mark deny</Button><Button size="sm" variant="outline" disabled={!selectedCount || busy} onClick={() => stageSelectedDecision("unmatch")}>Mark unmatched</Button><Button size="sm" variant="outline" disabled={!selectedCount || busy} onClick={() => stageSelectedDecision("block")}>Mark block</Button><Button size="sm" variant="outline" disabled={busy || (!allFiltered && !selectedMappedIds.length) || (allFiltered && status !== "mapped")} onClick={() => openRefresh(allFiltered ? [] : selectedMappedIds, undefined, allFiltered)}>Refresh mapped SKUs</Button></div>
        </div>
        {pendingDecisionCount ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-900 dark:text-blue-100"><span>{numberLabel(pendingDecisionCount)} pending decision{pendingDecisionCount === 1 ? "" : "s"} ready to save.</span><div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => void savePendingCategoryDecisions(false)} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Save</Button><Button size="sm" variant="outline" onClick={() => void savePendingCategoryDecisions(true)} disabled={busy}>Save and update</Button><Button size="sm" variant="ghost" onClick={() => setPendingCategoryDecisions({})} disabled={busy}>Clear</Button></div></div> : null}
      </CardHeader>
      <CardContent className="p-0">{loading ? <div className="grid gap-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : <Table className="table-fixed" style={{ width: tableWidth }}><colgroup><col style={{ width: columnWidths.select }} /><col style={{ width: columnWidths.local }} /><col style={{ width: columnWidths.channel }} /><col style={{ width: columnWidths.status }} /><col style={{ width: columnWidths.action }} /></colgroup><TableHeader><TableRow><TableHead className="w-10" style={{ width: columnWidths.select }} />{resizableHeader("Local category", "local")}{resizableHeader("Channel category", "channel")}{resizableHeader("Status", "status")}{resizableHeader("Action", "action", "text-right")}</TableRow></TableHeader><TableBody>{sortedRows.map((row) => {
        const id = rowId(row)
        const suggestion = row.pendingSuggestion
        const pendingDecision = pendingCategoryDecisions[id]
        const statusValue = row.reviewStatus || (row.mapping?.blocked ? "blocked" : suggestion ? "pending" : row.mapping?.categoryId ? "mapped" : "missing")
        const channelPath = row.mapping?.categoryPath || row.mapping?.categoryId || suggestion?.categoryPath || suggestion?.categoryId || ""
        const confidencePercent = row.confidence === null || row.confidence === undefined ? null : Math.round(Number(row.confidence) * 100)
        const confidenceLabel = confidencePercent === null ? "" : `${confidencePercent}%`
        const confidenceClass = confidencePercent === null ? "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300" : confidencePercent >= 75 ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : confidencePercent >= 50 ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300" : "border-destructive/30 bg-destructive/10 text-destructive"
        const statusClass = statusValue === "mapped" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : statusValue === "pending" ? "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300" : statusValue === "blocked" || statusValue === "denied" ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-300"
        return <TableRow key={id} className="odd:bg-muted/20 hover:bg-primary/5 dark:odd:bg-muted/10 dark:hover:bg-primary/10">
          <TableCell><Checkbox aria-label={`Select ${row.name}`} checked={allFiltered || selected.has(id)} onCheckedChange={(checked) => toggleRow(id, checked === true)} /></TableCell>
          <TableCell className="whitespace-normal border-l-2 border-blue-500/40 bg-blue-500/5 align-top py-2 dark:bg-blue-500/10"><a className="block break-words text-sm font-medium leading-5 text-blue-950 hover:underline dark:text-blue-100" href={`/categories/${encodeURIComponent(id)}`}>{row.name || "Unnamed category"}</a>{showCategoryStats ? <><p className="mt-0.5 text-[11px] text-muted-foreground">{numberLabel(row.productCount || 0)} products / {numberLabel(row.stockProductCount || 0)} in stock</p><p className="mt-0.5 truncate text-[11px] text-muted-foreground">{(row.topVendors || []).slice(0, 2).map((vendor) => vendor.name).filter(Boolean).join(" / ") || "No vendor summary"}</p></> : null}</TableCell>
          <TableCell className="whitespace-normal border-l-2 border-emerald-500/40 bg-emerald-500/5 align-top py-2 dark:bg-emerald-500/10"><div className="flex min-w-0 items-start gap-2"><div className="min-w-0 flex-1"><p className="break-words text-[13px] font-medium leading-5 text-emerald-950 dark:text-emerald-100" title={channelPath || "No channel category selected"}>{channelPath || "No channel category selected"}</p>{suggestion?.categoryPath && !row.mapping?.categoryId ? <div className="mt-1 flex flex-wrap items-center gap-1.5"><Badge variant="outline" className={cn("h-5 px-1.5 text-[11px]", confidenceClass)}>Suggested {confidenceLabel || "no score"}</Badge></div> : null}{row.mapping?.blockReason ? <p className="mt-1 break-words text-xs text-destructive">{row.mapping.blockReason}</p> : null}</div><ChannelCategoryPicker compact channel={channel === "ebay" ? "eBay" : "Shopify"} localCategory={row.name || ""} savedId={row.mapping?.categoryId} selectedId={pendingDecision?.mapping?.categoryId || row.mapping?.categoryId} disabled={busy} onSelect={candidate => setManualMappingPrompt({ row, mapping: { categoryId: candidate.id, categoryPath: candidate.path, taxonomyVersion: candidate.taxonomyVersion, categoryHandle: candidate.categoryHandle, googleCategory: candidate.googleCategory } })} /></div></TableCell>
          <TableCell className="whitespace-normal align-top"><Badge variant="outline" className={cn("capitalize", statusClass)}>{statusValue === "missing" ? "unmatched" : statusValue.replace(/_/g, " ")}</Badge>{pendingDecision ? <Badge variant="outline" className="ml-1 border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300">Save pending: {pendingDecision.action === "unmatch" ? "unmatched" : pendingDecision.action}</Badge> : null}{row.locked ? <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><LockKeyhole className="size-3" /> Locked</p> : null}<p className="mt-1 text-xs text-muted-foreground">{row.lastRefreshAt ? dateLabel(row.lastRefreshAt) : "Not refreshed"}</p>{row.lastRefreshJobId ? <a className="text-xs text-primary hover:underline" href={`/jobs/${encodeURIComponent(row.lastRefreshJobId)}`}>Open job</a> : null}</TableCell>
          <TableCell><div className="flex justify-end"><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant={pendingDecision ? "secondary" : "outline"}>{pendingDecision ? pendingDecision.action === "unmatch" ? "unmatched" : pendingDecision.action : "Action"}</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={busy || (!suggestion?.categoryId && !row.mapping?.categoryId)} onClick={() => stageCategoryDecision(row, "approve")}><CheckCircle2 className="size-4" /> Mark approve</DropdownMenuItem><DropdownMenuItem disabled={busy} onClick={() => stageCategoryDecision(row, "deny")}>Mark deny</DropdownMenuItem><DropdownMenuItem disabled={busy} onClick={() => stageCategoryDecision(row, "unmatch")}>Mark unmatched</DropdownMenuItem><DropdownMenuItem disabled={busy} onClick={() => stageCategoryDecision(row, "block")}>Mark block</DropdownMenuItem>{pendingDecision ? <DropdownMenuItem disabled={busy} onClick={() => setPendingCategoryDecisions((current) => { const next = { ...current }; delete next[id]; return next })}>Clear pending decision</DropdownMenuItem> : null}<DropdownMenuSeparator />{row.mapping?.categoryId ? <><DropdownMenuItem onClick={() => openRefresh([id], row.name)}><RefreshCw className="size-4" /> Refresh category now</DropdownMenuItem><DropdownMenuItem onClick={() => { openRefresh([id], row.name); setRefreshTiming("later") }}><Clock3 className="size-4" /> Schedule refresh</DropdownMenuItem><DropdownMenuSeparator /></> : null}<DropdownMenuItem asChild><a href={`/categories/${encodeURIComponent(id)}`}>Open category</a></DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></TableCell>
        </TableRow>
      })}{!sortedRows.length && <TableRow><TableCell colSpan={5} className="h-28 text-center text-muted-foreground">No category mappings match this review view.</TableCell></TableRow>}</TableBody></Table>}</CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t text-sm text-muted-foreground"><span>Page {page} of {pageCount} / {numberLabel(total)} categories</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => void load(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={loading || page >= pageCount} onClick={() => void load(page + 1)}>Next</Button></div></CardFooter>
    </Card>
    <Dialog open={Boolean(manualMappingPrompt)} onOpenChange={(open) => { if (!open && !busy) setManualMappingPrompt(null) }}><DialogContent className="sm:max-w-2xl"><DialogHeader><DialogTitle>Mark channel category for approval?</DialogTitle><DialogDescription>This adds the manual match to pending decisions. It will not save until you click Save or Save and update.</DialogDescription></DialogHeader>{manualMappingPrompt ? <div className="grid gap-3 text-sm"><div className="rounded-md border p-3"><p className="text-xs font-medium uppercase text-muted-foreground">Local category</p><p className="mt-1 font-medium">{manualMappingPrompt.row.name || "Unnamed category"}</p></div><div className="rounded-md border border-primary/30 bg-primary/5 p-3"><p className="text-xs font-medium uppercase text-muted-foreground">{channel === "ebay" ? "eBay" : "Shopify"} category to save</p><p className="mt-1 font-medium">{String(manualMappingPrompt.mapping.categoryPath || manualMappingPrompt.mapping.fullName || manualMappingPrompt.mapping.name || manualMappingPrompt.mapping.categoryId || "")}</p>{manualMappingPrompt.mapping.categoryId ? <p className="mt-1 font-mono text-xs text-muted-foreground">{String(manualMappingPrompt.mapping.categoryId)}</p> : null}</div></div> : null}<DialogFooter><Button variant="outline" onClick={() => setManualMappingPrompt(null)} disabled={busy}>Cancel</Button><Button onClick={() => { if (!manualMappingPrompt) return; stageCategoryDecision(manualMappingPrompt.row, "approve", manualMappingPrompt.mapping); setManualMappingPrompt(null) }} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Add to pending</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(refreshPrompt)} onOpenChange={(open) => { if (!open && !busy) setRefreshPrompt(null) }}><DialogContent><DialogHeader><DialogTitle>Refresh category SKU records</DialogTitle><DialogDescription>{(refreshPrompt?.categoryName || refreshPrompt?.count === 1) ? "Queue a DataPlus metadata refresh for this category." : `Queue a DataPlus metadata refresh for ${numberLabel(refreshPrompt?.count || 0)} categories.`}</DialogDescription></DialogHeader><div className="grid gap-4"><Alert><Clock3 className="size-4" /><AlertTitle>Local metadata only</AlertTitle><AlertDescription>This updates DataPlus SKU/channel category records. It does not publish or revise marketplace listings.</AlertDescription></Alert><div className="grid gap-2 sm:grid-cols-2"><Button type="button" variant={refreshTiming === "now" ? "default" : "outline"} onClick={() => setRefreshTiming("now")}><RefreshCw className="size-4" /> Now</Button><Button type="button" variant={refreshTiming === "later" ? "default" : "outline"} onClick={() => setRefreshTiming("later")}><Clock3 className="size-4" /> Schedule</Button></div>{refreshTiming === "later" ? <div className="grid gap-2"><Label>Scheduled time</Label><Input type="datetime-local" value={refreshAt} min={new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)} onChange={(event) => setRefreshAt(event.target.value)} /></div> : null}</div><DialogFooter><Button variant="outline" onClick={() => setRefreshPrompt(null)} disabled={busy}>Cancel</Button><Button onClick={startRefreshPrompt} disabled={busy || (refreshTiming === "later" && !refreshAt)}>{busy ? <Loader2 className="size-4 animate-spin" /> : refreshTiming === "later" ? <Clock3 className="size-4" /> : <RefreshCw className="size-4" />}{refreshTiming === "later" ? "Schedule refresh" : "Refresh now"}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

export function SkuChangesPage() {
  const [rows, setRows] = useState<CatalogChange[]>([])
  const [summary, setSummary] = useState<Record<string, number>>({})
  const [facets, setFacets] = useState<{ fields?: string[]; sources?: string[]; vendors?: string[] }>({})
  const [tracking, setTracking] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<Record<string, string>>({ view: "tracked" })
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const limit = 50
  const fieldLabel = (field = "") => field.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (letter) => letter.toUpperCase())
  const value = (item: unknown) => item === null || item === undefined || item === "" ? "-" : typeof item === "boolean" ? (item ? "Yes" : "No") : typeof item === "number" ? item.toLocaleString(undefined, { maximumFractionDigits: 4 }) : String(item)

  async function load(nextPage = page, nextFilters = filters) {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(nextPage), limit: String(limit) })
      Object.entries(nextFilters).forEach(([key, item]) => { if (item) params.set(key, item) })
      const result = await api<{ rows?: CatalogChange[]; summary?: Record<string, number>; facets?: { fields?: string[]; sources?: string[]; vendors?: string[] }; tracking?: Record<string, unknown>; total?: number; page?: number }>(`/api/catalog/changes?${params}`)
      setRows(result.rows || []); setSummary(result.summary || {}); setFacets(result.facets || {}); setTracking(result.tracking || {}); setTotal(Number(result.total || result.rows?.length || 0)); setPage(Number(result.page || nextPage))
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load SKU changes.") } finally { setLoading(false) }
  }
  useEffect(() => { void load(1, filters) }, [])
  const setFilter = (key: string, item: string) => setFilters((current) => ({ ...current, [key]: item }))
  const apply = () => void load(1, filters)
  const clear = () => { const next = { view: "tracked" }; setFilters(next); void load(1, next) }
  const totalPages = Math.max(1, Math.ceil(total / limit))
  const cards: Array<[string, number, string]> = [["Tracked changes", Number(summary.total || tracking.productChangeEvents || 0), "Latest source differences"], ["Cost changes", Number(summary.costChanges || 0), "Vendor price movement"], ["Stock changes", Number(summary.stockChanges || 0), "Quantity or stock status"], ["Closeout signals", Number(summary.closeouts || 0), "Discontinued / closeout"]]
  return <div className="grid gap-5"><PageHeader eyebrow="Catalog" title="SKU Changes" description="Audit source-feed changes before they affect product, pricing, inventory, or clearance decisions." action={<div className="flex gap-2"><Button size="sm" variant="outline" asChild><a href={`/api/catalog/changes.csv?${new URLSearchParams({ ...filters, limit: "25000" })}`}><FileDown className="size-4" /> Export CSV</a></Button><Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button></div>} />
    <div className="grid gap-2 md:grid-cols-3"><Button variant={filters.view === "tracked" ? "secondary" : "outline"} className="h-auto justify-start p-3 text-left" onClick={() => { const next = { ...filters, view: "tracked" }; setFilters(next); void load(1, next) }}><span><span className="block">Tracked changes</span><span className="text-xs text-muted-foreground">Configured field audit</span></span></Button><Button variant={filters.view === "active" ? "secondary" : "outline"} className="h-auto justify-start p-3 text-left" onClick={() => { const next = { ...filters, view: "active" }; setFilters(next); void load(1, next) }}><span><span className="block">Active catalog impact</span><span className="text-xs text-muted-foreground">Changes touching Products</span></span></Button><Button variant={filters.view === "opportunities" ? "secondary" : "outline"} className="h-auto justify-start p-3 text-left" onClick={() => { const next = { ...filters, view: "opportunities" }; setFilters(next); void load(1, next) }}><span><span className="block">Clearance opportunities</span><span className="text-xs text-muted-foreground">Closeout, in-stock, price cuts</span></span></Button></div>
    <Card><CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4"><div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={filters.q || ""} onChange={(event) => setFilter("q", event.target.value)} onKeyDown={(event) => event.key === "Enter" && apply()} placeholder="SKU, vendor SKU, title, brand" /></div><Select value={filters.field || "all"} onValueChange={(item) => setFilter("field", item === "all" ? "" : item)}><SelectTrigger><SelectValue placeholder="All fields" /></SelectTrigger><SelectContent><SelectItem value="all">All fields</SelectItem>{(facets.fields || []).map((item) => <SelectItem key={item} value={item}>{fieldLabel(item)}</SelectItem>)}</SelectContent></Select><Select value={filters.direction || "all"} onValueChange={(item) => setFilter("direction", item === "all" ? "" : item)}><SelectTrigger><SelectValue placeholder="Any direction" /></SelectTrigger><SelectContent><SelectItem value="all">Any direction</SelectItem><SelectItem value="up">Up</SelectItem><SelectItem value="down">Down</SelectItem><SelectItem value="closeout">Closeout</SelectItem><SelectItem value="changed">Changed</SelectItem></SelectContent></Select><Select value={filters.catalogPresence || "all"} onValueChange={(item) => setFilter("catalogPresence", item === "all" ? "" : item)}><SelectTrigger><SelectValue placeholder="Any catalog state" /></SelectTrigger><SelectContent><SelectItem value="all">Any catalog state</SelectItem><SelectItem value="active">Active products</SelectItem><SelectItem value="products">Any product</SelectItem><SelectItem value="source-only">Source only</SelectItem></SelectContent></Select><Select value={filters.vendor || "all"} onValueChange={(item) => setFilter("vendor", item === "all" ? "" : item)}><SelectTrigger><SelectValue placeholder="All vendors" /></SelectTrigger><SelectContent><SelectItem value="all">All vendors</SelectItem>{(facets.vendors || []).slice(0, 1000).map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><Select value={filters.stock || "all"} onValueChange={(item) => setFilter("stock", item === "all" ? "" : item)}><SelectTrigger><SelectValue placeholder="Any stock" /></SelectTrigger><SelectContent><SelectItem value="all">Any stock</SelectItem><SelectItem value="in-stock">In stock</SelectItem><SelectItem value="out-of-stock">Out of stock</SelectItem></SelectContent></Select><div className="flex items-center gap-2"><Button onClick={apply} disabled={loading}>Search</Button><Button variant="ghost" onClick={clear}>Clear</Button></div></CardContent></Card>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, count, note]) => <Card key={label}><CardContent className="p-4"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold">{numberLabel(count)}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></CardContent></Card>)}</div>
    <Card><CardHeader className="border-b"><CardTitle className="text-sm">Change audit</CardTitle><CardDescription>{tracking.snapshotExists ? "Baseline ready. Results show differences detected since the last source import." : "Baseline missing. The next source import will establish comparison history."}</CardDescription></CardHeader><CardContent className="p-0">{loading ? <div className="grid gap-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Supplier</TableHead><TableHead>Catalog</TableHead><TableHead>Field</TableHead><TableHead>Before</TableHead><TableHead>After</TableHead><TableHead>Delta</TableHead><TableHead>Direction</TableHead><TableHead>Imported</TableHead></TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={`${row.sku}-${row.field}-${row.importedAt}-${index}`}><TableCell><a href={`/products/${encodeURIComponent(row.sku || "")}`} className="font-medium hover:underline">{row.sku || "-"}</a><p className="max-w-56 truncate text-xs text-muted-foreground">{row.title || ""}</p></TableCell><TableCell>{row.supplier || "-"}</TableCell><TableCell><Badge variant={row.activeCatalog ? "default" : row.productId ? "secondary" : "outline"}>{row.activeCatalog ? "Main catalog" : row.productId ? "Inactive product" : "Source only"}</Badge></TableCell><TableCell>{fieldLabel(row.field)}</TableCell><TableCell className="max-w-40 truncate">{value(row.before)}</TableCell><TableCell className="max-w-40 truncate">{value(row.after)}</TableCell><TableCell>{row.deltaPercent !== undefined && row.deltaPercent !== null ? `${Number(row.deltaPercent).toFixed(1)}%` : value(row.delta)}</TableCell><TableCell><Badge variant={row.direction === "up" ? "default" : row.direction === "down" ? "secondary" : "outline"}>{row.direction === "closeout" ? "Closeout" : row.direction || "Changed"}</Badge></TableCell><TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dateLabel(row.importedAt)}</TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted-foreground">No source changes match this view.</TableCell></TableRow>}</TableBody></Table></div>}</CardContent><div className="flex items-center justify-between border-t p-3 text-sm text-muted-foreground"><span>Page {page} of {totalPages} | {numberLabel(total)} changes</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => void load(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={loading || page >= totalPages} onClick={() => void load(page + 1)}>Next</Button></div></div></Card>
  </div>
}

export function AttributeGroupsPage() {
  const [groups, setGroups] = useState<Array<{ id?: string; label?: string; aliases?: string[]; updatedAt?: string }>>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState({ label: "", aliases: "" })
  async function load() { setLoading(true); try { const result = await api<{ groups?: Array<{ id?: string; label?: string; aliases?: string[]; updatedAt?: string }> }>("/api/categories/attribute-groups"); setGroups(result.groups || []) } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load attribute groups.") } finally { setLoading(false) } }
  useEffect(() => { void load() }, [])
  async function save(group?: { id?: string; label?: string; aliases?: string[] }) { const label = group ? group.label || "" : draft.label; const aliases = group ? group.aliases || [] : draft.aliases.split(/[\n,]/).map((item) => item.trim()).filter(Boolean); if (!label.trim()) return toast.error("Attribute group name is required."); try { const result = await api<{ groups?: typeof groups }>("/api/categories/attribute-groups", { method: "POST", body: JSON.stringify({ id: group?.id, label, aliases }) }); setGroups(result.groups || []); setDraft({ label: "", aliases: "" }); toast.success("Attribute group saved.") } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save attribute group.") } }
  return <div className="grid gap-5"><PageHeader eyebrow="Catalog" title="Attribute Groups" description="Reusable names and aliases that keep channel requirements consistent across category profiles." action={<Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button>} /><Card><CardHeader className="border-b"><CardTitle className="text-sm">Add attribute group</CardTitle></CardHeader><CardContent className="grid gap-3 p-4 md:grid-cols-[minmax(180px,0.7fr)_minmax(240px,1fr)_auto]"><Input value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Group name" /><Input value={draft.aliases} onChange={(event) => setDraft((current) => ({ ...current, aliases: event.target.value }))} placeholder="Aliases, separated by commas" /><Button onClick={() => void save()}>Add group</Button></CardContent></Card><Card><CardContent className="p-0">{loading ? <div className="grid gap-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Group</TableHead><TableHead>Aliases</TableHead><TableHead>Updated</TableHead><TableHead /></TableRow></TableHeader><TableBody>{groups.map((group) => <TableRow key={group.id || group.label}><TableCell><Input defaultValue={group.label} onBlur={(event) => { if (event.target.value !== group.label) void save({ ...group, label: event.target.value }) }} /></TableCell><TableCell><Input defaultValue={(group.aliases || []).join(", ")} onBlur={(event) => void save({ ...group, aliases: event.target.value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean) })} /></TableCell><TableCell>{dateLabel(group.updatedAt)}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => void save(group)}>Save</Button></TableCell></TableRow>)}{!groups.length && <TableRow><TableCell colSpan={4} className="h-28 text-center text-muted-foreground">No attribute groups yet.</TableCell></TableRow>}</TableBody></Table></div>}</CardContent></Card></div>
}

export function VendorMappingsPage() {
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([])
  const [mainCategories, setMainCategories] = useState<string[]>([])
  const [query, setQuery] = useState("")
  const [supplier, setSupplier] = useState("all")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState("")
  async function load() { setLoading(true); try { const params = new URLSearchParams({ limit: "1000" }); if (query.trim()) params.set("q", query.trim()); if (supplier !== "all") params.set("supplier", supplier); const result = await api<{ rows?: Array<Record<string, unknown>>; mainCategories?: string[] }>(`/api/vendor-category-mappings?${params}`); setRows(result.rows || []); setMainCategories(result.mainCategories || []) } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load vendor mappings.") } finally { setLoading(false) } }
  useEffect(() => { void load() }, [])
  const suppliers = [...new Set(rows.map((row) => String(row.supplier || "")).filter(Boolean))].sort()
  async function save(row: Record<string, unknown>, mainCategory: string, addAsMainCategory = false) { const key = `${row.supplier}|${row.vendorCategory}`; if (!mainCategory.trim()) return toast.error("Choose a main category or add the vendor category as a new main category."); setSaving(key); try { const result = await api<{ categoryCreated?: boolean; productsMapped?: number }>("/api/vendor-category-mappings", { method: "POST", body: JSON.stringify({ supplier: row.supplier, vendorCategory: row.vendorCategory, mainCategory, sampleSku: row.sampleSku, matchCount: row.matchCount, addAsMainCategory }) }); toast.success(result.categoryCreated ? `Main category created and ${numberLabel(result.productsMapped)} SKU${Number(result.productsMapped) === 1 ? "" : "s"} mapped.` : "Vendor category mapping saved."); await load() } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save vendor mapping.") } finally { setSaving("") } }
  return <div className="grid gap-5"><PageHeader eyebrow="Catalog" title="Vendor Category Mappings" description="Map supplier category paths to one main catalog category. Main categories are the canonical product types used by every channel." action={<Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button>} /><Card><CardHeader className="gap-3 border-b"><div className="grid gap-2 md:grid-cols-[minmax(220px,1fr)_240px_auto]"><div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && void load()} placeholder="Search vendor or main category" /></div><Select value={supplier} onValueChange={setSupplier}><SelectTrigger><SelectValue placeholder="All suppliers" /></SelectTrigger><SelectContent><SelectItem value="all">All suppliers</SelectItem>{suppliers.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><Button onClick={() => void load()} disabled={loading}>Search</Button></div><CardDescription>{numberLabel(rows.filter((row) => !row.mapped).length)} unmapped rows require attention. Mapping is saved immediately and becomes the default for future supplier SKUs.</CardDescription></CardHeader><CardContent className="p-0">{loading ? <div className="grid gap-2 p-4"><Skeleton className="h-14" /><Skeleton className="h-14" /></div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Supplier category</TableHead><TableHead>Supplier</TableHead><TableHead>Sample / SKUs</TableHead><TableHead>Main category</TableHead><TableHead>Status</TableHead><TableHead /></TableRow></TableHeader><TableBody>{rows.map((row) => { const key = `${row.supplier}|${row.vendorCategory}`; const mapped = Boolean(row.mapped); const current = String(row.mainCategory || ""); return <TableRow key={key}><TableCell className="min-w-80"><p className="font-medium">{String(row.vendorCategory || "-")}</p></TableCell><TableCell>{String(row.supplier || "-")}</TableCell><TableCell><p>{String(row.sampleSku || "-")}</p><p className="text-xs text-muted-foreground">{numberLabel(Number(row.matchCount || 0))} SKUs</p></TableCell><TableCell className="min-w-80"><MappingCategoryInput categories={mainCategories} value={current} onSave={(next) => void save(row, next)} /></TableCell><TableCell><Badge variant={mapped ? "default" : "outline"}>{mapped ? "Mapped" : "Unmapped"}</Badge></TableCell><TableCell><Button size="sm" variant="outline" disabled={Boolean(saving)} onClick={() => void save(row, String(row.vendorCategory || ""), true)}>{saving === key ? <Loader2 className="size-4 animate-spin" /> : "Add as main"}</Button></TableCell></TableRow>})}{!rows.length && <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">No vendor category mappings match these filters.</TableCell></TableRow>}</TableBody></Table></div>}</CardContent></Card></div>
}

function MappingCategoryInput({ categories, value, onSave }: { categories: string[]; value: string; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const matches = categories.filter((category) => category.toLowerCase().includes(draft.toLowerCase())).slice(0, 50)
  return <div className="flex gap-2"><Select value={categories.includes(draft) ? draft : "custom"} onValueChange={(next) => { if (next !== "custom") { setDraft(next); onSave(next) } }}><SelectTrigger><SelectValue placeholder="Select main category" /></SelectTrigger><SelectContent><SelectItem value="custom">Search or type a category</SelectItem>{matches.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select><Input className="w-40" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === "Enter" && onSave(draft)} placeholder="Category" /><Button size="sm" onClick={() => onSave(draft)}>Save</Button></div>
}

export function MainCatalogPage({ inventoryOnly = false, totalSkuCount = 0 }: { inventoryOnly?: boolean; totalSkuCount?: number }) {
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [facets, setFacets] = useState<{ suppliers?: string[]; brands?: string[]; manufacturers?: string[]; categories?: string[] }>({})
  const [rows, setRows] = useState<ProductItem[]>([])
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<CatalogItem | null>(null)
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterField, setFilterField] = useState("supplier")
  const [filterSearch, setFilterSearch] = useState("")
  const [filterSelection, setFilterSelection] = useState<string[]>([])
  const pageSize = 25

  async function load(nextPage = page, nextFilters = filters) {
    setLoading(true)
    try {
      const params = new URLSearchParams({ q: query, page: String(nextPage), limit: String(pageSize), fastPage: "true" })
      Object.entries(nextFilters).forEach(([key, value]) => { if (value) params.set(key, value) })
      const result = await api<{ inventory?: ProductItem[]; total?: number; page?: number; hasMore?: boolean }>(`/api/inventory?${params}`)
      setRows(result.inventory || [])
      setTotal(Number(result.total || 0))
      setHasMore(Boolean(result.hasMore))
      setPage(Number(result.page || nextPage))
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load main catalog products.") } finally { setLoading(false) }
  }

  useEffect(() => {
    api<{ facets?: { suppliers?: string[]; brands?: string[]; manufacturers?: string[] } }>("/api/inventory/facets")
      .then((result) => setFacets(result.facets || {}))
      .catch(() => {})
    load(1, {})
  }, [])

  const title = inventoryOnly ? "Inventory" : "Products"
  const description = inventoryOnly ? "Main catalog stock, replenishable overrides, and channel inventory state." : "Approved SKUs managed for Shopify and every connected sales channel. Product results are cached briefly for fast repeat access."
  const filterCount = Object.values(filters).filter(Boolean).length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const filterDefinitions: Record<string, { label: string; values: string[]; display: (value: string) => string }> = {
    channelStatus: { label: "Channel", values: ["shopify-live", "shopify-linked", "shopify-missing", "shopify-ready", "shopify-not-ready", "shopify-unpublished", "ebay-live", "ebay-unverified", "ebay-detected", "ebay-offer", "ebay-validated-ready", "ebay-ready", "ebay-not-ready", "ebay-sync-warning", "ebay-needs-relink", "ebay-missing", "walmart-live", "walmart-detected", "walmart-not-live", "walmart-submitted", "walmart-launch-exception", "walmart-approval-required", "walmart-retryable-system", "walmart-needs-relink", "walmart-condition-mismatch", "walmart-other-rejection", "walmart-accepted-not-live", "walmart-error", "walmart-ready", "walmart-not-ready", "walmart-missing", "walmart-offer-ready", "walmart-offer-blocked", "walmart-new-ready", "walmart-new-blocked", "walmart-offer-not-found", "walmart-check-error", "walmart-launch-ready", "walmart-launch-blocked"], display: channelFilterLabel },
    hasStock: { label: "Inventory", values: ["true", "false"], display: (value) => value === "true" ? "In stock" : "Out of stock" },
    supplier: { label: "Supplier", values: facets.suppliers || [], display: (value) => value },
    brand: { label: "Brand", values: facets.brands || [], display: (value) => value },
    manufacturer: { label: "Manufacturer", values: facets.manufacturers || [], display: (value) => value },
    active: { label: "Status", values: ["true", "false"], display: (value) => value === "true" ? "Active" : "Inactive" },
  }
  const activeDefinition = filterDefinitions[filterField]
  const matchingValues = activeDefinition.values.filter((value) => activeDefinition.display(value).trim().toLowerCase().startsWith(filterSearch.trim().toLowerCase())).slice(0, 250)
  const resetFilters = () => { setFilters({}); setQuery(""); load(1, {}) }
  const toggleSelection = (value: string) => setFilterSelection((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])
  const applyFilter = () => {
    if (!filterSelection.length) return
    const next = { ...filters, [filterField]: filterSelection.join("|") }
    setFilters(next)
    setFilterOpen(false)
    setFilterSelection([])
    setFilterSearch("")
    load(1, next)
  }
  const removeFilter = (key: string) => { const next = { ...filters }; delete next[key]; setFilters(next); load(1, next) }
  const applySavedFilter = (next: Record<string, string>) => { setFilters(next); load(1, next) }
  return <div className="grid gap-5"><PageHeader eyebrow="Catalog" title={title} description={description} action={<Button variant="outline" onClick={() => load()} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button>} /><Card><CardHeader className="grid gap-3 border-b"><div className="flex flex-wrap items-center gap-2"><div className="relative"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input className="w-[360px] max-w-[70vw] pl-8" placeholder="Search SKU, title, brand, category" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") load(1) }} /></div><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline">Saved filters</Button></DropdownMenuTrigger><DropdownMenuContent align="start"><DropdownMenuItem onSelect={() => applySavedFilter({ channelStatus: "shopify-live" })}>Shopify storefront live</DropdownMenuItem><DropdownMenuItem onSelect={() => applySavedFilter({ hasStock: "true" })}>In stock</DropdownMenuItem><DropdownMenuItem onSelect={() => applySavedFilter({ channelStatus: "shopify-missing" })}>Not in Shopify catalog</DropdownMenuItem></DropdownMenuContent></DropdownMenu><DropdownMenu open={filterOpen} onOpenChange={setFilterOpen}><DropdownMenuTrigger asChild><Button size="sm" variant="outline">+ Filter</Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="w-[380px] p-3"><div className="grid gap-3"><p className="text-xs font-semibold uppercase text-muted-foreground">Add product filter</p><div className="grid gap-1"><Label className="text-xs">Field</Label><Select value={filterField} onValueChange={(value) => { setFilterField(value); setFilterSelection([]); setFilterSearch("") }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(filterDefinitions).map(([key, definition]) => <SelectItem key={key} value={key}>{definition.label}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1"><Label className="text-xs">Operator</Label><Input value="Is any of" disabled /></div><div className="grid gap-1"><Label className="text-xs">Value</Label><div className="relative"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search values" value={filterSearch} onChange={(event) => setFilterSearch(event.target.value)} /></div></div><div className="max-h-52 overflow-y-auto rounded-md border">{matchingValues.map((value) => <label key={value} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted"><Checkbox checked={filterSelection.includes(value)} onCheckedChange={() => toggleSelection(value)} />{activeDefinition.display(value)}</label>)}{!matchingValues.length && <p className="p-3 text-sm text-muted-foreground">No values found.</p>}</div><div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setFilterOpen(false)}>Cancel</Button><Button size="sm" onClick={applyFilter} disabled={!filterSelection.length}>Apply filter</Button></div></div></DropdownMenuContent></DropdownMenu><Button size="sm" variant="ghost" onClick={resetFilters} disabled={!filterCount && !query}>Clear</Button>{Object.entries(filters).map(([key, value]) => <Badge key={key} variant="outline" className="gap-1 border-primary/35 bg-primary/5 text-primary">{filterDefinitions[key]?.label || key} is {value.split("|").map((item) => filterDefinitions[key]?.display(item) || item).join(", ")}<button className="ml-1" onClick={() => removeFilter(key)} aria-label={`Remove ${filterDefinitions[key]?.label || key} filter`}>x</button></Badge>)}</div></CardHeader><CardContent className="p-4">{loading ? <div className="grid gap-2"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : <><div className="mb-3 text-xs text-muted-foreground">{totalSkuCount ? `${numberLabel(totalSkuCount)} total SKUs` : total ? `${numberLabel(total)} approved SKUs` : `${numberLabel(rows.length)} shown`} / page {page}</div><div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Product</TableHead><TableHead>Supplier</TableHead><TableHead>Brand</TableHead><TableHead>Category</TableHead><TableHead>Stock</TableHead><TableHead>Price</TableHead><TableHead>Shopify</TableHead><TableHead /></TableRow></TableHeader><TableBody>{rows.map((item) => <TableRow key={item.sku}><TableCell className="font-medium">{item.sku}</TableCell><TableCell className="max-w-80"><p className="truncate">{item.title || "Untitled"}</p></TableCell><TableCell>{item.supplier || item.vendor || "-"}</TableCell><TableCell>{item.brand || "-"}</TableCell><TableCell className="max-w-64"><p className="truncate">{item.mainCategory || item.category || "Uncategorized"}</p></TableCell><TableCell>{numberLabel(item.qty ?? item.stockQty)}</TableCell><TableCell>{moneyLabel(item.websitePrice ?? item.price)}</TableCell><TableCell><Badge variant={item.shopifyId ? "default" : "outline"}>{item.shopifyId ? (item.shopifyPublished ? "Live" : "Linked") : "Not linked"}</Badge></TableCell><TableCell><Button size="icon" variant="ghost" onClick={() => setSelected(item)} title="Open SKU"><MoreHorizontal className="size-4" /></Button></TableCell></TableRow>)}{!rows.length && <TableRow><TableCell colSpan={9} className="py-10 text-center text-muted-foreground">No approved products match these filters.</TableCell></TableRow>}</TableBody></Table></div><div className="mt-3 flex items-center justify-end gap-2"><Button size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => load(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={loading || (total ? page >= totalPages : !hasMore)} onClick={() => load(page + 1)}>Next</Button></div></>}</CardContent></Card><ProductDetailSheet sourceItem={selected} open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null) }} /></div>
}

export function InventorySourceCell({ item }: { item: ProductItem }) {
  const physical = (item.warehouseStock || []).filter((row) => row.isPhysical !== false && row.inventorySourceType !== "supplier_feed").reduce((sum, row) => sum + Number(row.qty || 0), 0)
  const dataWarehouseRows = (item.warehouseStock || []).filter((row) => row.isPhysical === false || row.inventorySourceType === "supplier_feed")
  const supplier = dataWarehouseRows.length
    ? dataWarehouseRows.reduce((sum, row) => sum + Number(row.qty || 0), 0)
    : (item.vendorOffers || []).reduce((sum, row) => sum + Number(row.stockQty ?? row.qty ?? 0), 0)
  return <div className="flex min-w-44 flex-wrap items-center gap-1.5"><Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Physical {numberLabel(physical)}</Badge><Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">Supplier {numberLabel(supplier)}</Badge><span className="w-full truncate text-xs text-muted-foreground" title={item.supplier || item.vendor || ""}>{item.supplier || item.vendor || "No primary supplier"}</span></div>
}

type SalesReportRow = Record<string, string | number | null | undefined>
type SalesReportData = {
  generatedAt?: string
  range?: { from?: string; to?: string; channel?: string; costScope?: string }
  summary?: SalesReportRow
  daily?: SalesReportRow[]
  monthly?: SalesReportRow[]
  channels?: SalesReportRow[]
  brands?: SalesReportRow[]
  products?: SalesReportRow[]
  customers?: SalesReportRow[]
  paymentStatuses?: SalesReportRow[]
}
type SalesReportOrder = { order_id?: string; order_number?: string; internal_order_number?: string; marketplace_order_id?: string; source?: string; channel_source?: string; buyer?: string; sales_at?: string; status?: string; net_sales?: number; product_cost?: number; shipping_cost?: number; marketplace_fees?: number; estimated_profit?: number; cost_status?: string; missing_product_cost?: boolean; missing_label_cost?: boolean }

function reportNumber(row: SalesReportRow | undefined, key: string) {
  return Number(row?.[key] || 0)
}

function reportDateLabel(value: unknown, options: Intl.DateTimeFormatOptions) {
  const raw = String(value || "").trim()
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return "Date unavailable"
  const [, year, monthText, day] = match
  const month = Number(monthText)
  if (month < 1 || month > 12) return "Date unavailable"
  const monthName = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month - 1]
  if (options.month === "long" && options.year === "numeric") return `${monthName} ${year}`
  return `${monthName.slice(0, 3)} ${Number(day)}`
}

function priorSalesRange(from: string, to: string) {
  const start = new Date(`${from}T12:00:00`)
  const end = new Date(`${(to || from)}T12:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return { from: "", to: "" }
  const span = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1)
  const previousEnd = new Date(start)
  previousEnd.setDate(previousEnd.getDate() - 1)
  const previousStart = new Date(previousEnd)
  previousStart.setDate(previousStart.getDate() - (span - 1))
  return { from: localDateKey(previousStart), to: localDateKey(previousEnd) }
}

export function ShippingReportsPage() {
  const initialRange = useMemo(() => salesDateRangeBounds("last30"), [])
  const [range, setRange] = useState("last30")
  const [dateFrom, setDateFrom] = useState(initialRange.from)
  const [dateTo, setDateTo] = useState(initialRange.to)
  const [channel, setChannel] = useState("all")
  const [availableChannels, setAvailableChannels] = useState<string[]>([])
  const [applied, setApplied] = useState({ from: initialRange.from, to: initialRange.to, channel: "all" })

  const selectRange = (value: string) => {
    setRange(value)
    if (value === "custom") return
    const next = salesDateRangeBounds(value)
    setDateFrom(next.from)
    setDateTo(next.to)
  }
  const applyRange = () => {
    if (!dateFrom || !dateTo) { toast.error("Choose both dates before applying the report."); return }
    if (dateFrom > dateTo) { toast.error("The From date must be before the To date."); return }
    setApplied({ from: dateFrom, to: dateTo, channel })
  }
  const rememberChannels = (values: string[]) => setAvailableChannels((current) => [...new Set([...current, ...values])].sort((a, b) => a.localeCompare(b)))

  return <div className="grid min-w-0 gap-5 [&>*]:min-w-0">
    <PageHeader eyebrow="Reporting" title="Shipping Report" description="Carrier expense, customer shipping revenue, label activity, reconciliation, and shipping profitability in one dedicated workspace." />
    <Card><CardContent className="flex flex-wrap items-end gap-2 p-4">
      <div className="grid gap-1"><Label className="text-xs">Period</Label><Select value={range} onValueChange={selectRange}><SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="today">Today</SelectItem><SelectItem value="yesterday">Yesterday</SelectItem><SelectItem value="last7">Last 7 days</SelectItem><SelectItem value="last30">Last 30 days</SelectItem><SelectItem value="lastMonth">Last month</SelectItem><SelectItem value="lastQuarter">Last quarter</SelectItem><SelectItem value="lastYear">Last year</SelectItem><SelectItem value="ytd">Year to date</SelectItem><SelectItem value="custom">Custom range</SelectItem></SelectContent></Select></div>
      <div className="grid gap-1"><Label className="text-xs">From</Label><Input className="h-9 w-36" type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setRange("custom") }} /></div>
      <div className="grid gap-1"><Label className="text-xs">To</Label><Input className="h-9 w-36" type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setRange("custom") }} /></div>
      <div className="grid gap-1"><Label className="text-xs">Channel</Label><Select value={channel} onValueChange={setChannel}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All channels</SelectItem>{availableChannels.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
      <Button size="sm" className="h-9" onClick={applyRange}><RefreshCw className="size-4" /> Apply</Button>
    </CardContent></Card>
    <Suspense fallback={<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-24" />)}</div>}>
      <SalesShippingReport from={applied.from} to={applied.to} channel={applied.channel} active hideHeading onChannelsChange={rememberChannels} />
    </Suspense>
  </div>
}

export function SalesReportsPage() {
  const initialRange = salesDateRangeBounds("last30")
  const [range, setRange] = useState("last30")
  const [dateFrom, setDateFrom] = useState(initialRange.from)
  const [dateTo, setDateTo] = useState(initialRange.to)
  const [channel, setChannel] = useState("all")
  const [costScope, setCostScope] = useState<"all" | "complete" | "missing">("all")
  const [compare, setCompare] = useState(true)
  const [tab, setTab] = useState("overview")
  const [dailyView, setDailyView] = useState<"chart" | "table">("chart")
  const [activeChannel, setActiveChannel] = useState("")
  const [data, setData] = useState<SalesReportData>({})
  const [comparison, setComparison] = useState<SalesReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [reportOrders, setReportOrders] = useState<SalesReportOrder[]>([])
  const [reportOrderTotal, setReportOrderTotal] = useState(0)
  const [reportOrderPage, setReportOrderPage] = useState(1)
  const [reportOrdersLoading, setReportOrdersLoading] = useState(false)
  const reportRequestRef = useRef<AbortController | null>(null)

  const load = async (from = dateFrom, to = dateTo, selectedChannel = channel, includeComparison = compare, selectedCostScope = costScope) => {
    if (!from || !to) { toast.error("Choose both dates before applying the report."); return }
    reportRequestRef.current?.abort()
    const controller = new AbortController()
    reportRequestRef.current = controller
    try {
      const params = new URLSearchParams({ from, to })
      if (selectedChannel !== "all") params.set("channel", selectedChannel)
      if (selectedCostScope !== "all") params.set("costScope", selectedCostScope)
      const cacheKey = `reports:sales:${params.toString()}`
      const cached = readWorkspaceCache<SalesReportData>(cacheKey)
      if (cached) setData(cached)
      setLoading(!cached)
      let prior: { from: string; to: string } | null = null
      let comparisonParams: URLSearchParams | null = null
      let comparisonCacheKey = ""
      if (includeComparison) {
        prior = priorSalesRange(from, to)
        comparisonParams = new URLSearchParams({ from: prior.from, to: prior.to })
        if (selectedChannel !== "all") comparisonParams.set("channel", selectedChannel)
        if (selectedCostScope !== "all") comparisonParams.set("costScope", selectedCostScope)
        comparisonCacheKey = `reports:sales:${comparisonParams.toString()}`
        const cachedComparison = readWorkspaceCache<SalesReportData>(comparisonCacheKey)
        if (cachedComparison) setComparison(cachedComparison)
      }
      const result = await api<SalesReportData>(`/api/reports/sales?${params}`, { signal: controller.signal })
      if (controller.signal.aborted) return
      setData(result)
      writeWorkspaceCache(cacheKey, result)
      if (includeComparison && comparisonParams) {
        const priorResult = await api<SalesReportData>(`/api/reports/sales?${comparisonParams}`, { signal: controller.signal })
        if (controller.signal.aborted) return
        setComparison(priorResult)
        writeWorkspaceCache(comparisonCacheKey, priorResult)
      } else setComparison(null)
      setError("")
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load sales reporting.")
    } finally {
      if (reportRequestRef.current === controller) {
        reportRequestRef.current = null
        setLoading(false)
      }
    }
  }

  useEffect(() => {
    void load(initialRange.from, initialRange.to, "all", true)
    return () => reportRequestRef.current?.abort()
  }, [])

  const loadReportOrders = async (page = reportOrderPage, selectedCostScope = costScope) => {
    setReportOrdersLoading(true)
    try {
      const params = new URLSearchParams({ from: dateFrom, to: dateTo, page: String(page), costScope: selectedCostScope })
      if (channel !== "all") params.set("channel", channel)
      const result = await api<{ rows?: SalesReportOrder[]; total?: number }>(`/api/reports/sales/orders?${params}`)
      setReportOrders(result.rows || [])
      setReportOrderTotal(Number(result.total || 0))
      setReportOrderPage(page)
    } catch (reason) { toast.error(reason instanceof Error ? reason.message : "Unable to load report orders.") }
    finally { setReportOrdersLoading(false) }
  }

  const applyRange = () => { setReportOrders([]); setReportOrderPage(1); void load() }
  const selectRange = (value: string) => {
    setRange(value)
    if (value === "custom") return
    const next = salesDateRangeBounds(value)
    setDateFrom(next.from)
    setDateTo(next.to)
  }
  const summary = data.summary || {}
  const comparisonSummary = comparison?.summary || {}
  const compareLabel = (metric: string) => {
    if (!comparison) return ""
    const current = reportNumber(summary, metric)
    const prior = reportNumber(comparisonSummary, metric)
    if (!prior) return "No prior-period baseline"
    const percentage = (current - prior) / Math.abs(prior) * 100
    return `${percentage >= 0 ? "+" : ""}${percentage.toFixed(1)}% vs prior period`
  }
  const availableChannels = [...new Set((data.channels || []).map((row) => String(row.channel || "")).filter(Boolean))]
  const dailyChartData = (data.daily || []).map((row) => ({
    date: String(row.date || ""),
    label: reportDateLabel(row.date, { month: "short", day: "numeric" }),
    netSales: reportNumber(row, "net_sales"),
    grossSales: reportNumber(row, "gross_sales"),
    profit: reportNumber(row, "estimated_profit"),
  }))
  const channelChartData = (data.channels || []).map((row, index) => ({
    channel: String(row.channel || "Unclassified"),
    netSales: reportNumber(row, "net_sales"),
    orders: reportNumber(row, "order_count"),
    profit: reportNumber(row, "estimated_profit"),
    fill: `var(--chart-${index % 5 + 1})`,
  }))
  const selectedChannel = channelChartData.find((row) => row.channel === activeChannel) || channelChartData[0]
  const downloadRows = (name: string, headers: string[], rows: SalesReportRow[]) => {
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`
    const csv = [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ""))].map((row) => row.map(escape).join(",")).join("\n")
    const href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    const anchor = document.createElement("a")
    anchor.href = href
    anchor.download = `${name}-${dateFrom}-to-${dateTo}.csv`
    anchor.click()
    URL.revokeObjectURL(href)
  }

  const reportControls = <div className="flex flex-wrap items-end gap-2"><div className="grid gap-1"><Label className="text-xs">Period</Label><Select value={range} onValueChange={selectRange}><SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="today">Today</SelectItem><SelectItem value="yesterday">Yesterday</SelectItem><SelectItem value="last7">Last 7 days</SelectItem><SelectItem value="last30">Last 30 days</SelectItem><SelectItem value="lastMonth">Last month</SelectItem><SelectItem value="lastQuarter">Last quarter</SelectItem><SelectItem value="lastYear">Last year</SelectItem><SelectItem value="ytd">Year to date</SelectItem><SelectItem value="custom">Custom range</SelectItem></SelectContent></Select></div><div className="grid gap-1"><Label className="text-xs">From</Label><Input className="h-9 w-36" type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setRange("custom") }} /></div><div className="grid gap-1"><Label className="text-xs">To</Label><Input className="h-9 w-36" type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setRange("custom") }} /></div><div className="grid gap-1"><Label className="text-xs">Channel</Label><Select value={channel} onValueChange={setChannel}><SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All channels</SelectItem>{availableChannels.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1"><Label className="text-xs">Cost data</Label><Select value={costScope} onValueChange={(value) => setCostScope(value as "all" | "complete" | "missing")}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Include all orders</SelectItem><SelectItem value="complete">Complete costs only</SelectItem><SelectItem value="missing">Needs cost review</SelectItem></SelectContent></Select></div><label className="mb-2 flex items-center gap-2 text-sm"><Checkbox checked={compare} onCheckedChange={(value) => setCompare(value === true)} />Compare prior period</label><Button size="sm" className="h-9" disabled={!dateFrom || !dateTo} onClick={applyRange}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{loading ? "Apply new report" : "Apply"}</Button></div>

  return <div className="grid min-w-0 gap-5 [&>*]:min-w-0">
    <PageHeader eyebrow="Reporting" title="Sales Reports" description="Sales performance across every channel, with an explicit estimated profit model until landed costs, marketplace fees, and returns reconciliation are complete." action={<DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline"><FileDown className="size-4" /> Export</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => downloadRows("sales-by-day", ["date", "order_count", "gross_sales", "refunds", "net_sales", "customer_shipping_collected", "estimated_profit", "units"], data.daily || [])}>Sales by day CSV</DropdownMenuItem><DropdownMenuItem onClick={() => downloadRows("sales-by-month", ["month", "order_count", "gross_sales", "refunds", "net_sales", "customer_shipping_collected", "estimated_profit", "units"], data.monthly || [])}>Sales by month CSV</DropdownMenuItem><DropdownMenuItem onClick={() => downloadRows("sales-by-channel", ["channel", "order_count", "gross_sales", "refunds", "net_sales", "customer_shipping_collected", "estimated_profit", "units"], data.channels || [])}>Sales by channel CSV</DropdownMenuItem><DropdownMenuItem onClick={() => downloadRows("sales-by-brand", ["brand", "order_count", "units", "product_sales", "estimated_product_cost", "estimated_product_profit"], data.brands || [])}>Sales by brand CSV</DropdownMenuItem><DropdownMenuItem onClick={() => downloadRows("sales-by-product", ["sku", "title", "brand", "supplier", "order_count", "units", "product_sales", "estimated_product_cost", "estimated_product_profit"], data.products || [])}>Sales by product CSV</DropdownMenuItem><DropdownMenuItem onClick={() => downloadRows("sales-by-customer", ["customer", "order_count", "net_sales", "average_order_value", "last_order_at"], data.customers || [])}>Sales by customer CSV</DropdownMenuItem></DropdownMenuContent></DropdownMenu>} />
    <Card><CardContent className="p-4">{reportControls}</CardContent></Card>
    {loading ? <Alert><Loader2 className="size-4 animate-spin" /><AlertTitle>Generating report</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-2">Report results are locked while this range is calculated. Update the filters and choose <strong>Apply new report</strong> to cancel this request and use the new range instead.<Button size="sm" variant="outline" onClick={() => reportRequestRef.current?.abort()}>Cancel report</Button></AlertDescription></Alert> : null}
    <div className={`relative ${loading ? "pointer-events-none select-none opacity-55" : ""}`} aria-busy={loading}>
    {error ? <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Sales reporting could not load</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    {loading && !data.generatedAt ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-24" />)}</div> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Detail label="Net sales" value={moneyLabel(reportNumber(summary, "net_sales"))} />
        <Detail label="Gross sales" value={moneyLabel(reportNumber(summary, "gross_sales"))} />
        <Detail label="Refunds / reversals" value={moneyLabel(reportNumber(summary, "refunds"))} />
        <Detail label="Orders" value={numberLabel(reportNumber(summary, "order_count"))} />
        <Detail label="Average order value" value={moneyLabel(reportNumber(summary, "average_order_value"))} />
        <Detail label="Estimated profit" value={moneyLabel(reportNumber(summary, "estimated_profit"))} />
        <Detail label="Estimated margin" value={`${(reportNumber(summary, "estimated_margin") * 100).toFixed(1)}%`} />
        <Detail label="Units sold" value={numberLabel(reportNumber(summary, "units"))} />
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-md border bg-muted/25 px-3 py-2 text-xs text-muted-foreground"><span>Net sales {compareLabel("net_sales")}</span><span>Orders {compareLabel("order_count")}</span><span>Estimated profit {compareLabel("estimated_profit")}</span><span>Cost data on {(reportNumber(summary, "cost_coverage") * 100).toFixed(1)}% of reportable orders.</span><Button size="sm" variant="outline" className="h-7" onClick={() => { setCostScope("missing"); setTab("orders"); setReportOrderPage(1); void loadReportOrders(1, "missing") }}>{numberLabel(reportNumber(summary, "missing_cost_order_count"))} need cost review</Button></div>
      <Tabs className="min-w-0" value={tab} onValueChange={setTab}><div className="max-w-full overflow-x-auto rounded-md border bg-card p-1"><TabsList className="h-auto min-w-max justify-start bg-transparent p-0"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="time">Sales over time</TabsTrigger><TabsTrigger value="performance">Channels and brands</TabsTrigger><TabsTrigger value="products">Products and customers</TabsTrigger><TabsTrigger value="orders">Orders</TabsTrigger><TabsTrigger value="quality">Metric notes</TabsTrigger></TabsList></div>
        <TabsContent value="overview" className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,.7fr)]">
          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
              <div><CardTitle className="text-base">Net sales trend</CardTitle><CardDescription>Hover a point for daily net sales. Open the table when you need row-level detail.</CardDescription></div>
              <Button size="sm" variant="outline" onClick={() => { setDailyView("table"); setTab("time") }}>View daily table</Button>
            </CardHeader>
            <CardContent>{dailyChartData.length ? <SalesAreaChart data={dailyChartData} /> : <p className="py-16 text-center text-sm text-muted-foreground">No paid, reportable sales match this date range.</p>}</CardContent>
          </Card>
          <Card><CardHeader><CardTitle className="text-base">Sales health</CardTitle><CardDescription>Use this as a directional operating view, then reconcile the accounting ledger for final books.</CardDescription></CardHeader><CardContent className="grid gap-3"><Detail label="Estimated product cost" value={moneyLabel(reportNumber(summary, "product_cost"))} /><Detail label="Customer shipping collected" value={moneyLabel(reportNumber(summary, "customer_shipping_collected"))} /><Detail label="Label cost, incl. adjustments" value={moneyLabel(reportNumber(summary, "shipping_cost"))} /><Detail label="Later label adjustments" value={moneyLabel(reportNumber(summary, "shipping_cost_adjustments"))} /><Detail label="Estimated marketplace fees" value={moneyLabel(reportNumber(summary, "marketplace_fees"))} /><Detail label="Refunded orders" value={numberLabel(reportNumber(summary, "refunded_order_count"))} /></CardContent></Card>
        </TabsContent>
        <TabsContent value="time" className="mt-5 grid gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader className="flex-row flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">Daily sales</CardTitle><CardDescription>Switch to the table only when you need the day-by-day detail.</CardDescription></div><div className="flex gap-2"><Button size="sm" variant={dailyView === "chart" ? "secondary" : "outline"} onClick={() => setDailyView("chart")}>Chart</Button><Button size="sm" variant={dailyView === "table" ? "secondary" : "outline"} onClick={() => setDailyView("table")}>Table</Button><Button size="icon" variant="outline" title="Export daily sales" onClick={() => downloadRows("sales-by-day", ["date", "order_count", "gross_sales", "refunds", "net_sales", "customer_shipping_collected", "estimated_profit", "units"], data.daily || [])}><FileDown className="size-4" /></Button></div></CardHeader>
            <CardContent className={dailyView === "table" ? "p-0" : undefined}>{dailyView === "chart" ? (dailyChartData.length ? <SalesAreaChart data={dailyChartData} detailed /> : <p className="py-16 text-center text-sm text-muted-foreground">No daily sales in this range.</p>) : <div className="max-h-[520px] overflow-auto"><Table><TableHeader><TableRow><TableHead>Date</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Refunds</TableHead><TableHead className="text-right">Net</TableHead><TableHead className="text-right">Est. profit</TableHead></TableRow></TableHeader><TableBody>{(data.daily || []).map((row) => <TableRow key={String(row.date)}><TableCell>{reportDateLabel(row.date, { month: "short", day: "numeric", year: "numeric" })}</TableCell><TableCell className="text-right">{numberLabel(reportNumber(row, "order_count"))}</TableCell><TableCell className="text-right">{moneyLabel(reportNumber(row, "gross_sales"))}</TableCell><TableCell className="text-right">{moneyLabel(reportNumber(row, "refunds"))}</TableCell><TableCell className="text-right font-medium">{moneyLabel(reportNumber(row, "net_sales"))}</TableCell><TableCell className={reportNumber(row, "estimated_profit") < 0 ? "text-right text-destructive" : "text-right"}>{moneyLabel(reportNumber(row, "estimated_profit"))}</TableCell></TableRow>)}</TableBody></Table></div>}</CardContent>
          </Card>
          <Card><CardHeader className="flex-row flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">Monthly sales</CardTitle><CardDescription>Calendar-month rollup for longer ranges.</CardDescription></div><Button size="icon" variant="outline" title="Export monthly sales" onClick={() => downloadRows("sales-by-month", ["month", "order_count", "gross_sales", "refunds", "net_sales", "customer_shipping_collected", "estimated_profit", "units"], data.monthly || [])}><FileDown className="size-4" /></Button></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Gross</TableHead><TableHead className="text-right">Refunds</TableHead><TableHead className="text-right">Net</TableHead><TableHead className="text-right">Est. profit</TableHead></TableRow></TableHeader><TableBody>{(data.monthly || []).map((row) => <TableRow key={String(row.month)}><TableCell>{reportDateLabel(row.month, { month: "long", year: "numeric" })}</TableCell><TableCell className="text-right">{numberLabel(reportNumber(row, "order_count"))}</TableCell><TableCell className="text-right">{moneyLabel(reportNumber(row, "gross_sales"))}</TableCell><TableCell className="text-right">{moneyLabel(reportNumber(row, "refunds"))}</TableCell><TableCell className="text-right font-medium">{moneyLabel(reportNumber(row, "net_sales"))}</TableCell><TableCell className="text-right">{moneyLabel(reportNumber(row, "estimated_profit"))}</TableCell></TableRow>)}{!(data.monthly || []).length && <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No monthly sales in this range.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
        </TabsContent>
        <TabsContent value="performance" className="mt-5 grid gap-5 xl:grid-cols-2">
          <Card><CardHeader><CardTitle className="text-base">Sales by channel</CardTitle><CardDescription>Hover or select a channel to inspect its sales mix. Customer-paid shipping remains included in net sales.</CardDescription></CardHeader><CardContent className="grid gap-5">{channelChartData.length ? <><div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(180px,.75fr)] sm:items-center"><SalesChannelPieChart data={channelChartData} onActiveChannel={setActiveChannel} /><div className="grid gap-3"><Label className="text-xs">Selected channel</Label><Select value={selectedChannel?.channel || ""} onValueChange={setActiveChannel}><SelectTrigger><SelectValue placeholder="Choose a channel" /></SelectTrigger><SelectContent>{channelChartData.map((entry) => <SelectItem key={entry.channel} value={entry.channel}>{entry.channel}</SelectItem>)}</SelectContent></Select><Detail label="Net sales" value={moneyLabel(selectedChannel?.netSales || 0)} /><Detail label="Orders" value={numberLabel(selectedChannel?.orders || 0)} /><Detail label="Estimated profit" value={moneyLabel(selectedChannel?.profit || 0)} /></div></div><div className="overflow-x-auto border-t"><Table><TableHeader><TableRow><TableHead>Channel</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Net sales</TableHead><TableHead className="text-right">Est. profit</TableHead></TableRow></TableHeader><TableBody>{(data.channels || []).map((row) => <TableRow key={String(row.channel)} className={String(row.channel) === selectedChannel?.channel ? "bg-muted/45" : undefined} onMouseEnter={() => setActiveChannel(String(row.channel || ""))}><TableCell className="font-medium">{String(row.channel)}</TableCell><TableCell className="text-right">{numberLabel(reportNumber(row, "order_count"))}</TableCell><TableCell className="text-right font-medium">{moneyLabel(reportNumber(row, "net_sales"))}</TableCell><TableCell className="text-right">{moneyLabel(reportNumber(row, "estimated_profit"))}</TableCell></TableRow>)}</TableBody></Table></div></> : <p className="py-16 text-center text-sm text-muted-foreground">No channel sales are available for this range.</p>}</CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Product sales by brand</CardTitle><CardDescription>Line-item product sales exclude order-level shipping. Product cost is estimated from the line or current catalog cost.</CardDescription></CardHeader><CardContent className="p-0"><div className="max-h-[520px] overflow-auto"><Table><TableHeader><TableRow><TableHead>Brand</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Units</TableHead><TableHead className="text-right">Product sales</TableHead><TableHead className="text-right">Est. profit</TableHead></TableRow></TableHeader><TableBody>{(data.brands || []).map((row) => <TableRow key={String(row.brand)}><TableCell className="font-medium">{String(row.brand)}</TableCell><TableCell className="text-right">{numberLabel(reportNumber(row, "order_count"))}</TableCell><TableCell className="text-right">{numberLabel(reportNumber(row, "units"))}</TableCell><TableCell className="text-right">{moneyLabel(reportNumber(row, "product_sales"))}</TableCell><TableCell className={reportNumber(row, "estimated_product_profit") < 0 ? "text-right text-destructive" : "text-right"}>{moneyLabel(reportNumber(row, "estimated_product_profit"))}</TableCell></TableRow>)}{!(data.brands || []).length && <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No line-item brand data is available for this range.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
        </TabsContent>
        <TabsContent value="products" className="mt-5 grid gap-5 xl:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">Top products</CardTitle><CardDescription>Line-item revenue by DataPlus mapped SKU when available.</CardDescription></CardHeader><CardContent className="p-0"><div className="max-h-[560px] overflow-auto"><Table><TableHeader><TableRow><TableHead>SKU / product</TableHead><TableHead>Brand</TableHead><TableHead className="text-right">Units</TableHead><TableHead className="text-right">Product sales</TableHead><TableHead className="text-right">Est. profit</TableHead></TableRow></TableHeader><TableBody>{(data.products || []).map((row) => <TableRow key={String(row.sku)}><TableCell className="min-w-60"><a href={`/inventory/${encodeURIComponent(String(row.sku || ""))}`} className="font-medium hover:underline">{String(row.sku)}</a><p className="max-w-64 truncate text-xs text-muted-foreground">{String(row.title || "Untitled product")}</p></TableCell><TableCell>{String(row.brand || "-")}</TableCell><TableCell className="text-right">{numberLabel(reportNumber(row, "units"))}</TableCell><TableCell className="text-right">{moneyLabel(reportNumber(row, "product_sales"))}</TableCell><TableCell className="text-right">{moneyLabel(reportNumber(row, "estimated_product_profit"))}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card><Card><CardHeader><CardTitle className="text-base">Top customers</CardTitle><CardDescription>Only the channel-provided buyer or customer ID is used. Marketplace relay identities remain channel-scoped.</CardDescription></CardHeader><CardContent className="p-0"><div className="max-h-[560px] overflow-auto"><Table><TableHeader><TableRow><TableHead>Customer</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Net sales</TableHead><TableHead className="text-right">Average order</TableHead><TableHead>Last order</TableHead></TableRow></TableHeader><TableBody>{(data.customers || []).map((row) => <TableRow key={String(row.customer)}><TableCell className="font-medium">{String(row.customer)}</TableCell><TableCell className="text-right">{numberLabel(reportNumber(row, "order_count"))}</TableCell><TableCell className="text-right">{moneyLabel(reportNumber(row, "net_sales"))}</TableCell><TableCell className="text-right">{moneyLabel(reportNumber(row, "average_order_value"))}</TableCell><TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dateLabel(String(row.last_order_at || ""))}</TableCell></TableRow>)}</TableBody></Table></div></CardContent></Card></TabsContent>
        <TabsContent value="orders" className="mt-5"><Card><CardHeader className="flex-row flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">Report order drill-down</CardTitle><CardDescription>Every sales total resolves to its source order. Cost-review status flags any order missing product cost, label cost, or both.</CardDescription></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void loadReportOrders(1)} disabled={reportOrdersLoading}>{reportOrdersLoading && <Loader2 className="size-4 animate-spin" />} Load orders</Button><Button size="sm" variant="outline" asChild><a href="/accounting">Open accounting review</a></Button></div></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Date</TableHead><TableHead>Customer</TableHead><TableHead>Channel</TableHead><TableHead>Cost coverage</TableHead><TableHead className="text-right">Net sales</TableHead><TableHead className="text-right">Product cost</TableHead><TableHead className="text-right">Label cost</TableHead><TableHead className="text-right">Est. profit</TableHead></TableRow></TableHeader><TableBody>{reportOrders.map((row) => <TableRow key={String(row.order_id)}><TableCell><a className="font-medium text-primary hover:underline" href={`/orders/${encodeURIComponent(String(row.order_id || ""))}`}>{row.order_number || row.internal_order_number || row.order_id}</a></TableCell><TableCell className="whitespace-nowrap">{reportDateLabel(row.sales_at, { month: "short", day: "numeric", year: "numeric" })}</TableCell><TableCell>{row.buyer || "-"}</TableCell><TableCell>{row.channel_source || row.source || "-"}</TableCell><TableCell><Badge variant={row.cost_status === "complete" ? "success" : "warning"}>{String(row.cost_status || "complete").replaceAll("_", " ")}</Badge></TableCell><TableCell className="text-right">{moneyLabel(Number(row.net_sales || 0))}</TableCell><TableCell className="text-right">{moneyLabel(Number(row.product_cost || 0))}</TableCell><TableCell className="text-right">{moneyLabel(Number(row.shipping_cost || 0))}</TableCell><TableCell className={Number(row.estimated_profit || 0) < 0 ? "text-right text-destructive" : "text-right"}>{moneyLabel(Number(row.estimated_profit || 0))}</TableCell></TableRow>)}{!reportOrders.length && <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted-foreground">Load the current report orders to inspect and reconcile the source records.</TableCell></TableRow>}</TableBody></Table></div>{reportOrderTotal > 0 && <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm"><span>{numberLabel(reportOrderTotal)} matching orders</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={reportOrderPage <= 1 || reportOrdersLoading} onClick={() => void loadReportOrders(reportOrderPage - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={reportOrdersLoading || reportOrderPage * 50 >= reportOrderTotal} onClick={() => void loadReportOrders(reportOrderPage + 1)}>Next</Button></div></div>}</CardContent></Card></TabsContent>
        <TabsContent value="quality" className="mt-5 grid gap-5 lg:grid-cols-2"><Card><CardHeader><CardTitle className="text-base">How DataPlus currently calculates sales</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm text-muted-foreground"><p><strong className="text-foreground">Gross sales</strong> use the paid amount when supplied by the channel, otherwise the reported order total.</p><p><strong className="text-foreground">Net sales</strong> are gross sales less imported channel refund amounts. Returns and refunds can arrive later than the original order date.</p><p><strong className="text-foreground">Customer shipping collected</strong> is source-provided shipping revenue already included in gross and net sales. It is displayed separately from the label cost and is not added to profit a second time.</p><p><strong className="text-foreground">Estimated profit</strong> is net sales less currently recorded product cost, label/shipping cost, and marketplace fees. Missing cost data is treated as zero, so estimates can be optimistic.</p><p><strong className="text-foreground">Brand and product reports</strong> use line-item sales and exclude order-level customer shipping because it cannot be reliably allocated across lines.</p></CardContent></Card><Card><CardHeader><CardTitle className="text-base">Payment states in this report</CardTitle><CardDescription>Explicitly unpaid, pending, failed, and voided orders are excluded. Import quality still determines how complete the historical picture is.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Channel payment state</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Net sales</TableHead></TableRow></TableHeader><TableBody>{(data.paymentStatuses || []).map((row) => <TableRow key={String(row.payment_status)}><TableCell>{String(row.payment_status)}</TableCell><TableCell className="text-right">{numberLabel(reportNumber(row, "order_count"))}</TableCell><TableCell className="text-right">{moneyLabel(reportNumber(row, "net_sales"))}</TableCell></TableRow>)}{!(data.paymentStatuses || []).length && <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">No payment-state data is available.</TableCell></TableRow>}</TableBody></Table></CardContent></Card></TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground">Generated {dateLabel(data.generatedAt)}. The reporting pattern follows Shopify’s configurable date ranges, comparisons, dimensions, filters, and exports, while keeping DataPlus cost and profit figures explicitly estimated.</p>
    </>}
    </div>
  </div>
}

type InventoryReportRow = {
  sku?: string
  title?: string
  marketplace_title?: string
  supplier?: string
  unitCost?: number
  reorderPoint?: number
  onHand?: number
  reserved?: number
  available?: number
  value?: number
  risk?: string
  last_physical_update?: string
  last_physical_update_at?: string
}

type InventoryReportData = {
  generatedAt?: string
  summary?: { activeProductCount?: number; physicalSkuCount?: number; physicalOnHand?: number; physicalReserved?: number; physicalAvailable?: number; physicalValue?: number; lowStockCount?: number; stockoutCount?: number; negativeAvailableCount?: number; noReorderPointCount?: number; stalePhysicalSkuCount?: number }
  warehouses?: Array<{ warehouseId?: string; warehouseName?: string; warehouseCode?: string; skuCount?: number; onHand?: number; reserved?: number; available?: number; value?: number; lastUpdated?: string }>
  risks?: InventoryReportRow[]
  topValue?: InventoryReportRow[]
  movement?: { eventCount?: number; last30Days?: Array<{ type?: string; count?: number; units?: number }>; daily?: Array<{ date?: string; received?: number; issued?: number; events?: number }> }
  receipts?: Array<{ receiptNumber?: string; receivedAt?: string; warehouseName?: string; receivedBy?: string; note?: string; items?: Array<{ sku?: string; title?: string; qtyReceived?: number }> }>
}

function inventoryMovementLabel(type?: string) {
  return String(type || "inventory activity").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function InventoryReportsPage() {
  const cachedInventoryReport = readWorkspaceCache<InventoryReportData>("reports:inventory")
  const [data, setData] = useState<InventoryReportData>(cachedInventoryReport || {})
  const [loading, setLoading] = useState(!cachedInventoryReport)
  const [error, setError] = useState("")
  const [tab, setTab] = useState("overview")

  const load = async () => {
    if (!readWorkspaceCache("reports:inventory")) setLoading(true)
    try {
      const result = await api<InventoryReportData>("/api/inventory/reports")
      setData(result)
      writeWorkspaceCache("reports:inventory", result)
      setError("")
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load inventory reporting.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const summary = data.summary || {}
  const risks = data.risks || []
  const topValue = data.topValue || []
  const daily = data.movement?.daily || []
  const maxDailyUnits = Math.max(1, ...daily.map((row) => Math.max(Number(row.received || 0), Number(row.issued || 0))))
  const riskTone = (risk?: string) => risk === "negative_available" ? "destructive" : risk === "stockout" ? "warning" : "secondary"
  const riskLabel = (risk?: string) => risk === "negative_available" ? "Negative available" : risk === "stockout" ? "Stockout" : "At reorder point"
  const exportRisks = () => {
    const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`
    const rows: unknown[][] = [["SKU", "Product", "Supplier", "Risk", "On hand", "Reserved", "Available", "Reorder point", "Unit cost"]]
    risks.forEach((row) => rows.push([row.sku, row.title || row.marketplace_title, row.supplier, riskLabel(row.risk), row.onHand, row.reserved, row.available, row.reorderPoint, row.unitCost]))
    const blob = new Blob([rows.map((row) => row.map(escape).join(",")).join("\n")], { type: "text/csv;charset=utf-8" })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = href
    anchor.download = `inventory-risk-report-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(href)
  }

  return <div className="grid gap-5">
    <PageHeader eyebrow="Inventory" title="Inventory Reports" description="Physical stock reporting for warehouse operations, receiving, replenishment, valuation, and movement. Supplier-feed availability is intentionally excluded from physical on-hand and valuation." action={<div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" asChild><a href="/inventory">Inventory workspace</a></Button><Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button></div>} />
    {error ? <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Inventory reporting could not load</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    {loading && !data.generatedAt ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-24" />)}</div> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Detail label="Physical on hand" value={numberLabel(summary.physicalOnHand)} />
        <Detail label="Reserved" value={numberLabel(summary.physicalReserved)} />
        <Detail label="Available to promise" value={numberLabel(summary.physicalAvailable)} />
        <Detail label="Physical inventory value" value={moneyLabel(summary.physicalValue)} />
        <Detail label="Stocked SKUs" value={`${numberLabel(summary.physicalSkuCount)} of ${numberLabel(summary.activeProductCount)} active`} />
        <Detail label="Replenishment risks" value={numberLabel(summary.lowStockCount)} />
        <Detail label="Stockouts" value={numberLabel(summary.stockoutCount)} />
        <Detail label="No reorder point" value={numberLabel(summary.noReorderPointCount)} />
      </div>
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-sm text-muted-foreground"><AlertTriangle className="size-4 shrink-0 text-amber-600" /><span>{numberLabel(summary.stalePhysicalSkuCount)} stocked SKU{Number(summary.stalePhysicalSkuCount || 0) === 1 ? " has" : "s have"} not had a physical stock update in 90 days. Negative available: {numberLabel(summary.negativeAvailableCount)}.</span></div>
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto rounded-md border bg-card p-1"><TabsList className="h-auto min-w-max justify-start bg-transparent p-0"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="risks">Replenishment risks ({numberLabel(risks.length)})</TabsTrigger><TabsTrigger value="movement">Movement</TabsTrigger><TabsTrigger value="receiving">Receiving ({numberLabel((data.receipts || []).length)})</TabsTrigger></TabsList></div>
        <TabsContent value="overview" className="mt-5 grid gap-5 xl:grid-cols-2">
          <Card><CardHeader><CardTitle className="text-base">Physical stock by warehouse</CardTitle><CardDescription>Warehouse balances and valuation use only physical locations.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Warehouse</TableHead><TableHead className="text-right">SKUs</TableHead><TableHead className="text-right">On hand</TableHead><TableHead className="text-right">Reserved</TableHead><TableHead className="text-right">Available</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader><TableBody>{(data.warehouses || []).map((row) => <TableRow key={row.warehouseId}><TableCell><p className="font-medium">{row.warehouseName || "Unknown warehouse"}</p><p className="text-xs text-muted-foreground">{row.warehouseCode || dateLabel(row.lastUpdated)}</p></TableCell><TableCell className="text-right tabular-nums">{numberLabel(row.skuCount)}</TableCell><TableCell className="text-right tabular-nums">{numberLabel(row.onHand)}</TableCell><TableCell className="text-right tabular-nums">{numberLabel(row.reserved)}</TableCell><TableCell className="text-right font-medium tabular-nums">{numberLabel(row.available)}</TableCell><TableCell className="text-right tabular-nums">{moneyLabel(row.value)}</TableCell></TableRow>)}{!(data.warehouses || []).length && <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No active physical warehouses are configured.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Highest-value physical stock</CardTitle><CardDescription>Current on-hand multiplied by the catalog unit cost.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Supplier</TableHead><TableHead className="text-right">On hand</TableHead><TableHead className="text-right">Unit cost</TableHead><TableHead className="text-right">Value</TableHead></TableRow></TableHeader><TableBody>{topValue.slice(0, 10).map((row) => <TableRow key={row.sku}><TableCell className="min-w-52"><a href={`/inventory/${encodeURIComponent(row.sku || "")}`} className="font-medium hover:underline">{row.sku}</a><p className="max-w-56 truncate text-xs text-muted-foreground">{row.title || row.marketplace_title || "Untitled product"}</p></TableCell><TableCell>{row.supplier || "-"}</TableCell><TableCell className="text-right tabular-nums">{numberLabel(row.onHand)}</TableCell><TableCell className="text-right tabular-nums">{moneyLabel(row.unitCost)}</TableCell><TableCell className="text-right font-medium tabular-nums">{moneyLabel(row.value)}</TableCell></TableRow>)}{!topValue.length && <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No physical stock has a catalog cost recorded.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card>
        </TabsContent>
        <TabsContent value="risks" className="mt-5"><Card><CardHeader className="flex-row flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">Replenishment and stockout queue</CardTitle><CardDescription>Only SKUs with a recorded physical warehouse balance appear here. Supplier feed stock does not clear a physical shortage.</CardDescription></div><Button size="sm" variant="outline" disabled={!risks.length} onClick={exportRisks}><FileDown className="size-4" /> Download CSV</Button></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>SKU / product</TableHead><TableHead>Supplier</TableHead><TableHead>Risk</TableHead><TableHead className="text-right">On hand</TableHead><TableHead className="text-right">Reserved</TableHead><TableHead className="text-right">Available</TableHead><TableHead className="text-right">Reorder</TableHead><TableHead>Last physical update</TableHead></TableRow></TableHeader><TableBody>{risks.map((row) => <TableRow key={row.sku}><TableCell className="min-w-64"><a href={`/inventory/${encodeURIComponent(row.sku || "")}`} className="font-medium hover:underline">{row.sku}</a><p className="max-w-72 truncate text-xs text-muted-foreground">{row.title || row.marketplace_title || "Untitled product"}</p></TableCell><TableCell>{row.supplier || "-"}</TableCell><TableCell><Badge variant={riskTone(row.risk)}>{riskLabel(row.risk)}</Badge></TableCell><TableCell className="text-right tabular-nums">{numberLabel(row.onHand)}</TableCell><TableCell className="text-right tabular-nums">{numberLabel(row.reserved)}</TableCell><TableCell className="text-right font-medium tabular-nums">{numberLabel(row.available)}</TableCell><TableCell className="text-right tabular-nums">{numberLabel(row.reorderPoint)}</TableCell><TableCell className="whitespace-nowrap text-xs text-muted-foreground">{dateLabel(row.last_physical_update || row.last_physical_update_at)}</TableCell></TableRow>)}{!risks.length && <TableRow><TableCell colSpan={8} className="h-28 text-center text-muted-foreground">No physical stockouts or reorder-point risks are currently recorded.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card></TabsContent>
        <TabsContent value="movement" className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,.75fr)]"><Card><CardHeader><CardTitle className="text-base">Fourteen-day physical movement</CardTitle><CardDescription>Positive movement is receiving, returns, or transfers in. Negative movement is fulfillment, transfers out, or adjustments.</CardDescription></CardHeader><CardContent className="grid gap-2">{daily.map((row) => <div key={row.date} className="grid grid-cols-[84px_minmax(0,1fr)_minmax(0,1fr)_64px] items-center gap-2 text-xs"><span className="text-muted-foreground">{new Date(`${row.date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span><div className="h-2 overflow-hidden rounded bg-emerald-500/15"><div className="h-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, Number(row.received || 0) / maxDailyUnits * 100))}%` }} /></div><div className="h-2 overflow-hidden rounded bg-amber-500/15"><div className="h-full bg-amber-500" style={{ width: `${Math.max(0, Math.min(100, Number(row.issued || 0) / maxDailyUnits * 100))}%` }} /></div><span className="text-right tabular-nums text-muted-foreground">{numberLabel(row.events)} evt</span></div>)}{!daily.length && <p className="text-sm text-muted-foreground">No physical inventory movements were recorded in this period.</p>}</CardContent></Card><Card><CardHeader><CardTitle className="text-base">Movement summary</CardTitle><CardDescription>{numberLabel(data.movement?.eventCount)} physical inventory events in the last 30 days.</CardDescription></CardHeader><CardContent className="grid gap-2">{(data.movement?.last30Days || []).map((row) => <div key={row.type} className="flex items-center justify-between gap-3 rounded-md border p-2.5 text-sm"><span>{inventoryMovementLabel(row.type)}</span><span className="font-medium tabular-nums">{row.units && row.units > 0 ? "+" : ""}{numberLabel(row.units)} units <span className="text-xs text-muted-foreground">/ {numberLabel(row.count)} events</span></span></div>)}{!(data.movement?.last30Days || []).length && <p className="text-sm text-muted-foreground">No movement types were recorded.</p>}</CardContent></Card></TabsContent>
        <TabsContent value="receiving" className="mt-5"><Card><CardHeader><CardTitle className="text-base">Recent manual receipts</CardTitle><CardDescription>Receipts posted from the receiving workflow or directly from a SKU inventory page.</CardDescription></CardHeader><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Receipt</TableHead><TableHead>Received</TableHead><TableHead>Warehouse</TableHead><TableHead>Items</TableHead><TableHead>Operator</TableHead><TableHead>Note</TableHead></TableRow></TableHeader><TableBody>{(data.receipts || []).map((receipt) => <TableRow key={receipt.receiptNumber}><TableCell className="font-medium">{receipt.receiptNumber}</TableCell><TableCell className="whitespace-nowrap">{dateLabel(receipt.receivedAt)}</TableCell><TableCell>{receipt.warehouseName || "-"}</TableCell><TableCell>{(receipt.items || []).map((item) => <div key={item.sku}><a href={`/inventory/${encodeURIComponent(item.sku || "")}`} className="font-medium hover:underline">{item.sku}</a> <span className="text-muted-foreground">x {numberLabel(item.qtyReceived)}</span></div>)}</TableCell><TableCell>{receipt.receivedBy || "-"}</TableCell><TableCell className="max-w-72 truncate" title={receipt.note}>{receipt.note || "-"}</TableCell></TableRow>)}{!(data.receipts || []).length && <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">No manual receipts have been posted yet.</TableCell></TableRow>}</TableBody></Table></div></CardContent></Card></TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground">Generated {dateLabel(data.generatedAt)}. Valuation is an operational estimate based on current catalog unit cost; it does not replace the accounting ledger or landed-cost reconciliation.</p>
    </>}
  </div>
}

export function InventoryWorkspace() {
  const [tab, setTab] = useState("inventory")
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState<Record<string, string>>({})
  const [rows, setRows] = useState<ProductItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [loading, setLoading] = useState(false)
  const [warehouses, setWarehouses] = useState<Array<{ id?: string; name?: string; code?: string; bins?: unknown[]; warehouseType?: string; inventorySourceType?: string; isPhysical?: boolean }>>([])
  const [transferItem, setTransferItem] = useState<ProductItem | null>(null)
  const [fromWarehouseId, setFromWarehouseId] = useState("")
  const [toWarehouseId, setToWarehouseId] = useState("")
  const [transferQty, setTransferQty] = useState("1")
  const [transferBusy, setTransferBusy] = useState(false)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  async function load(nextPage = page, nextFilters = filters) {
    setLoading(true)
    try {
      const params = new URLSearchParams({ q: query, page: String(nextPage), limit: String(pageSize), fastPage: "true", includeTotal: "true", inventoryWorkspace: "true" })
      Object.entries(nextFilters).forEach(([key, value]) => { if (value) params.set(key, value) })
      const result = await api<{ inventory?: ProductItem[]; total?: number; page?: number }>(`/api/inventory?${params}`)
      setRows(result.inventory || [])
      setTotal(Number(result.total || 0))
      setPage(Number(result.page || nextPage))
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load inventory.") } finally { setLoading(false) }
  }

  useEffect(() => {
    void load(1, {})
    loadAppReferences(["warehouses"])
      .then((result) => setWarehouses((result.warehouses || []) as typeof warehouses))
      .catch(() => {})
  }, [])

  const setFilter = (key: string, value: string) => { const next = { ...filters, [key]: value }; if (!value) delete next[key]; setFilters(next); void load(1, next) }
  const filterBadge = (key: string, label: string) => filters[key] ? <Badge key={key} variant="outline" className="gap-1">{label}: {filters[key]}<button onClick={() => setFilter(key, "")} aria-label={`Remove ${label} filter`}>x</button></Badge> : null
  const physicalWarehouses = warehouses.filter((row) => row.isPhysical !== false && row.inventorySourceType !== "supplier_feed")
  const openTransfer = (item: ProductItem) => { const currentPhysical = item.warehouseStock?.find((row) => row.isPhysical !== false && row.inventorySourceType !== "supplier_feed")?.warehouseId || ""; setTransferItem(item); setFromWarehouseId(currentPhysical); setToWarehouseId(physicalWarehouses.find((row) => row.id !== currentPhysical)?.id || ""); setTransferQty("1") }
  async function transfer() {
    if (!transferItem) return
    setTransferBusy(true)
    try {
      await api(`/api/inventory/${encodeURIComponent(transferItem.id || transferItem.sku || "")}/transfers`, { method: "POST", body: JSON.stringify({ fromWarehouseId, toWarehouseId, qty: Number(transferQty) }) })
      toast.success("Inventory transferred.")
      setTransferItem(null)
      void load(page)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to transfer inventory.") } finally { setTransferBusy(false) }
  }
  const lowRows = rows.filter((item) => Number(item.reorderPoint || 0) > 0 && Number(item.available ?? Number(item.qty || 0) - Number(item.reserved || 0)) <= Number(item.reorderPoint || 0))

  return <div className="grid gap-5">
    <PageHeader eyebrow="Catalog" title="Inventory" description="On-hand, reserved, available, replenishable, and warehouse stock for approved products." action={<Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button>} />
    <Tabs value={tab} onValueChange={setTab}>
      <div className="overflow-x-auto rounded-md border bg-card p-1"><TabsList className="h-auto min-w-max justify-start bg-transparent p-0"><TabsTrigger value="inventory" className="text-xs">Inventory</TabsTrigger><TabsTrigger value="replenishment" className="text-xs">Replenishment{total ? ` (${numberLabel(total)})` : ""}</TabsTrigger><TabsTrigger value="warehouses" className="text-xs">Warehouses ({warehouses.length})</TabsTrigger><TabsTrigger value="exports" className="text-xs">Exports</TabsTrigger></TabsList></div>
      <TabsContent value="inventory" className="mt-5"><Card><CardHeader className="gap-3 border-b"><div className="flex flex-wrap items-center gap-2"><div className="relative"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input className="w-80 max-w-[75vw] pl-8" placeholder="Search SKU, title, supplier" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(1) }} /></div><Select value={filters.inventoryAvailability || "all"} onValueChange={(value) => setFilter("inventoryAvailability", value === "all" ? "" : value)}><SelectTrigger className="w-40"><SelectValue placeholder="Availability" /></SelectTrigger><SelectContent><SelectItem value="all">All availability</SelectItem><SelectItem value="in-stock">In stock</SelectItem><SelectItem value="out-of-stock">Out of stock</SelectItem><SelectItem value="negative">Negative</SelectItem></SelectContent></Select><Select value={filters.lowStock || "all"} onValueChange={(value) => setFilter("lowStock", value === "all" ? "" : value)}><SelectTrigger className="w-36"><SelectValue placeholder="Stock level" /></SelectTrigger><SelectContent><SelectItem value="all">All stock</SelectItem><SelectItem value="true">Low stock</SelectItem><SelectItem value="false">Not low</SelectItem></SelectContent></Select><Select value={filters.replenishable || "all"} onValueChange={(value) => setFilter("replenishable", value === "all" ? "" : value)}><SelectTrigger className="w-40"><SelectValue placeholder="Replenishable" /></SelectTrigger><SelectContent><SelectItem value="all">All products</SelectItem><SelectItem value="true">Replenishable</SelectItem><SelectItem value="false">Not replenishable</SelectItem></SelectContent></Select><Select value={filters.warehouse || "all"} onValueChange={(value) => setFilter("warehouse", value === "all" ? "" : value)}><SelectTrigger className="w-48"><SelectValue placeholder="Warehouse" /></SelectTrigger><SelectContent><SelectItem value="all">All warehouses</SelectItem>{warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id || ""}>{warehouse.name || warehouse.id}</SelectItem>)}</SelectContent></Select><Button size="sm" variant="ghost" onClick={() => { setQuery(""); setFilters({}); void load(1, {}) }}>Clear</Button></div><div className="flex flex-wrap gap-2 text-xs">{filterBadge("inventoryAvailability", "Availability")}{filterBadge("lowStock", "Low stock")}{filterBadge("replenishable", "Replenishable")}{filterBadge("warehouse", "Warehouse")}</div></CardHeader><CardContent className="p-0">{loading ? <div className="grid gap-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>SKU / product</TableHead><TableHead>Recorded</TableHead><TableHead>Reserved</TableHead><TableHead>Available</TableHead><TableHead>Reorder</TableHead><TableHead>Warehouse</TableHead><TableHead>Cost</TableHead><TableHead>Stock sources</TableHead><TableHead>State</TableHead><TableHead /></TableRow></TableHeader><TableBody>{rows.map((item) => { const available = Number(item.available ?? Number(item.qty || 0) - Number(item.reserved || 0)); const low = Number(item.reorderPoint || 0) > 0 && available <= Number(item.reorderPoint || 0); return <TableRow key={item.id || item.sku}><TableCell className="min-w-64"><a className="font-medium hover:underline" href={`/inventory/${encodeURIComponent(item.sku || "")}`}>{item.sku}</a><p className="max-w-72 truncate text-xs text-muted-foreground">{item.marketplaceTitle || item.title || "Untitled product"}</p></TableCell><TableCell>{numberLabel(item.qty)}</TableCell><TableCell>{numberLabel(item.reserved)}</TableCell><TableCell className={available <= 0 ? "font-medium text-destructive" : "font-medium"}>{numberLabel(available)}</TableCell><TableCell>{numberLabel(item.reorderPoint)}</TableCell><TableCell><span title={item.warehouseStock?.map((row) => `${row.warehouseName}: ${numberLabel(row.qty)}`).join("\n")}>{item.warehouseCount ? `${item.warehouseCount} location${item.warehouseCount === 1 ? "" : "s"}` : "Unassigned"}</span></TableCell><TableCell>{moneyLabel(item.cost)}</TableCell><TableCell><InventorySourceCell item={item} /></TableCell><TableCell className="space-x-1">{low && <Badge variant="destructive">Low</Badge>}{(item.replenishableEffective ?? item.replenishable) && <Badge variant="secondary">Replenishable</Badge>}{!low && !(item.replenishableEffective ?? item.replenishable) && <Badge variant="outline">Normal</Badge>}</TableCell><TableCell><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => openTransfer(item)}>Transfer stock</DropdownMenuItem><DropdownMenuItem onClick={() => window.open(`/products/${encodeURIComponent(item.sku || "")}`, "_blank")}>Open product</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell></TableRow> })}{!rows.length && <TableRow><TableCell colSpan={10} className="h-28 text-center text-muted-foreground">No inventory rows match these filters.</TableCell></TableRow>}</TableBody></Table></div>}</CardContent><div className="flex flex-wrap items-center justify-between gap-3 border-t p-3 text-sm text-muted-foreground"><span>{numberLabel(total)} products | Page {page} of {totalPages}</span><div className="flex items-center gap-2"><Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); void load(1) }}><SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="25">25</SelectItem><SelectItem value="50">50</SelectItem><SelectItem value="100">100</SelectItem></SelectContent></Select><Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => void load(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => void load(page + 1)}>Next</Button></div></div></Card></TabsContent>
      <TabsContent value="replenishment" className="mt-5"><Card><CardHeader><CardTitle className="text-sm">Low-stock queue</CardTitle><CardDescription>Products where available quantity is at or below the reorder point. Use the inventory filters to narrow this queue by warehouse or supplier.</CardDescription></CardHeader><CardContent><div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => { setTab("inventory"); setFilter("lowStock", "true") }}>Open low-stock inventory</Button><Badge variant="outline">{numberLabel(lowRows.length)} on this page need review</Badge></div></CardContent></Card></TabsContent>
      <TabsContent value="warehouses" className="mt-5"><Card><CardHeader><CardTitle className="text-sm">Inventory locations and bins</CardTitle><CardDescription>Physical warehouses support receiving, audits, allocations, and transfers. DataWarehouse is a virtual supplier-feed location and cannot be used for physical operations.</CardDescription></CardHeader><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>Location</TableHead><TableHead>Type</TableHead><TableHead>Code</TableHead><TableHead>Bins</TableHead><TableHead /></TableRow></TableHeader><TableBody>{warehouses.map((warehouse) => { const physical = warehouse.isPhysical !== false && warehouse.inventorySourceType !== "supplier_feed"; return <TableRow key={warehouse.id}><TableCell className="font-medium">{warehouse.name || "Unnamed location"}</TableCell><TableCell><Badge variant="outline" className={physical ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"}>{physical ? "Physical warehouse" : "Supplier feed"}</Badge></TableCell><TableCell>{warehouse.code || "-"}</TableCell><TableCell>{Array.isArray(warehouse.bins) ? warehouse.bins.length : 0}</TableCell><TableCell><Button size="sm" variant="outline" onClick={() => { setTab("inventory"); setFilter("warehouse", warehouse.id || "") }}>View stock</Button></TableCell></TableRow> })}{!warehouses.length && <TableRow><TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No inventory locations are configured.</TableCell></TableRow>}</TableBody></Table></CardContent></Card></TabsContent>
      <TabsContent value="exports" className="mt-5"><Card><CardHeader><CardTitle className="text-sm">Inventory export</CardTitle><CardDescription>Download every product matching the current filters as a CSV, including available quantity, reorder point, supplier, and replenishable state.</CardDescription></CardHeader><CardContent><Button asChild variant="outline"><a href={`/api/inventory/export.csv?${new URLSearchParams({ q: query, ...filters })}`}><FileDown className="size-4" /> Download CSV</a></Button></CardContent></Card></TabsContent>
    </Tabs>
    <Dialog open={Boolean(transferItem)} onOpenChange={(open) => !open && setTransferItem(null)}><DialogContent><DialogHeader><DialogTitle>Transfer physical inventory</DialogTitle><DialogDescription>{transferItem?.sku} {transferItem?.title ? `- ${transferItem.title}` : ""}. Supplier-feed availability is not transferable.</DialogDescription></DialogHeader><div className="grid gap-4"><div className="grid gap-1"><Label>From warehouse</Label><Select value={fromWarehouseId} onValueChange={setFromWarehouseId}><SelectTrigger><SelectValue placeholder="Choose source" /></SelectTrigger><SelectContent>{physicalWarehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id || ""}>{warehouse.name || warehouse.id}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1"><Label>To warehouse</Label><Select value={toWarehouseId} onValueChange={setToWarehouseId}><SelectTrigger><SelectValue placeholder="Choose destination" /></SelectTrigger><SelectContent>{physicalWarehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id || ""}>{warehouse.name || warehouse.id}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1"><Label>Quantity</Label><Input type="number" min="1" value={transferQty} onChange={(event) => setTransferQty(event.target.value)} /></div></div><DialogFooter><Button variant="outline" onClick={() => setTransferItem(null)}>Cancel</Button><Button disabled={transferBusy || !fromWarehouseId || !toWarehouseId || fromWarehouseId === toWarehouseId || Number(transferQty) <= 0} onClick={() => void transfer()}>{transferBusy && <Loader2 className="size-4 animate-spin" />} Transfer</Button></DialogFooter></DialogContent></Dialog>
  </div>
}

export function SourceCatalogPage() {
  const paramsAtLoad = new URLSearchParams(window.location.search)
  const defaultFilters: SourceCatalogFilters = {
    suppliers: paramsAtLoad.get("suppliers")?.split("|").filter(Boolean) || [], productMembership: paramsAtLoad.get("productMembership") || "", stockStatus: paramsAtLoad.get("stockStatus") || "", hasStock: paramsAtLoad.get("hasStock") || "", stockQtyOperator: paramsAtLoad.get("stockQtyOperator") || "", stockQty: paramsAtLoad.get("stockQty") || "", hazardous: paramsAtLoad.get("hazardous") || "", toBeDiscontinued: paramsAtLoad.get("toBeDiscontinued") || "", active: paramsAtLoad.get("active") || "", brand: paramsAtLoad.get("brand") || "", category: paramsAtLoad.get("category") || "", manufacturer: paramsAtLoad.get("manufacturer") || "",
  }
  const [query, setQuery] = useState(paramsAtLoad.get("q") || "")
  const [pageSize, setPageSize] = useState(Number(paramsAtLoad.get("limit") || 25))
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState<CatalogResponse>({})
  const [filters, setFilters] = useState<SourceCatalogFilters>(defaultFilters)
  const [filterDraft, setFilterDraft] = useState<SourceCatalogFilters>(defaultFilters)
  const [filterOpen, setFilterOpen] = useState(false)
  const [quickFilterOpen, setQuickFilterOpen] = useState(false)
  const [quickFilterField, setQuickFilterField] = useState("suppliers")
  const [quickFilterSearch, setQuickFilterSearch] = useState("")
  const [quickFilterSelection, setQuickFilterSelection] = useState<string[]>([])
  const [facets, setFacets] = useState<SourceCatalogFacets>({})
  const [facetsLoading, setFacetsLoading] = useState(false)
  const [supplierSearch, setSupplierSearch] = useState("")
  const [selectedItem, setSelectedItem] = useState<CatalogItem | null>(null)
  const [selectedSkus, setSelectedSkusState] = useState<Set<string>>(new Set())
  const selectedSkusRef = useRef<Set<string>>(new Set())
  function setSelectedSkus(next: Set<string> | ((current: Set<string>) => Set<string>)) {
    const resolved = typeof next === "function" ? next(selectedSkusRef.current) : next
    selectedSkusRef.current = resolved
    setSelectedSkusState(resolved)
  }
  const [allFiltered, setAllFiltered] = useState(false)
  const [latestCursorStack, setLatestCursorStack] = useState<string[]>([""])
  const [promotionOpen, setPromotionOpen] = useState(false)
  const [promotionScope, setPromotionScope] = useState<"selected" | "filtered">("selected")
  const [promotionSkus, setPromotionSkus] = useState<string[]>([])
  const [promotionImpact, setPromotionImpact] = useState<{ matched?: number; importable?: number; newProducts?: number; existing?: number; limited?: boolean } | null>(null)
  const [promotionLoading, setPromotionLoading] = useState(false)
  const [importMode, setImportMode] = useState("new-and-update")

  const filterCount = Object.values(filters).reduce((count, value) => count + (Array.isArray(value) ? value.length : value ? 1 : 0), 0)
  const filterPayload = useMemo(() => ({ ...filters, suppliers: filters.suppliers.join("|") }), [filters])
  const rows = response.items || []
  const total = Number(response.totalMatches || rows.length || 0)
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const latestMode = !query.trim() && !filterCount
  const pageSkus = rows.map((item) => item.sku || "").filter(Boolean)
  const pageSelected = pageSkus.length > 0 && (allFiltered || pageSkus.every((sku) => selectedSkus.has(sku)))
  const selectedCount = allFiltered ? total : selectedSkus.size
  const quickFilterDefinitions: Record<string, { label: string; values: string[]; display: (value: string) => string; multiple?: boolean }> = {
    suppliers: { label: "Supplier", values: facets.suppliers || [], display: (value) => value, multiple: true },
    productMembership: { label: "Catalog membership", values: ["in-products", "not-in-products"], display: (value) => value === "in-products" ? "Already in Products" : "Source only" },
    hasStock: { label: "Stock", values: ["true", "false"], display: (value) => value === "true" ? "In stock" : "Out of stock" },
    toBeDiscontinued: { label: "Lifecycle", values: ["false", "true"], display: (value) => value === "true" ? "Discontinued / closeout" : "Current" },
    active: { label: "Record status", values: ["true", "false"], display: (value) => value === "true" ? "Active" : "Inactive" },
    hazardous: { label: "Hazardous", values: ["true", "false"], display: (value) => value === "true" ? "Hazardous" : "Not hazardous" },
    stockStatus: { label: "Stock status", values: facets.stockStatuses || [], display: (value) => value },
    brand: { label: "Brand", values: facets.brands || [], display: (value) => value },
    category: { label: "Category", values: facets.categories || [], display: (value) => value },
  }
  const quickDefinition = quickFilterDefinitions[quickFilterField]
  const quickValues = quickDefinition.values.filter((value) => quickDefinition.display(value).trim().toLowerCase().startsWith(quickFilterSearch.trim().toLowerCase())).slice(0, 250)

  function updateUrl(nextQuery = query, nextFilters = filters, nextLimit = pageSize) {
    const next = new URLSearchParams()
    if (nextQuery.trim()) next.set("q", nextQuery.trim())
    if (nextLimit !== 25) next.set("limit", String(nextLimit))
    for (const [key, value] of Object.entries(nextFilters)) {
      const text = Array.isArray(value) ? value.join("|") : value
      if (text) next.set(key, text)
    }
    const suffix = next.toString()
    window.history.replaceState({}, "", `/source-catalog${suffix ? `?${suffix}` : ""}`)
  }

  async function loadCatalog(nextPage = page, cursor = "", nextQuery = query, nextFilters = filters, nextLimit = pageSize) {
    setLoading(true)
    try {
      const next = new URLSearchParams({ q: nextQuery, page: String(nextPage), limit: String(nextLimit) })
      for (const [key, value] of Object.entries(nextFilters)) {
        const text = Array.isArray(value) ? value.join("|") : value
        if (text) next.set(key, text)
      }
      if (!nextQuery.trim() && !Object.values(nextFilters).some((value) => Array.isArray(value) ? value.length : value)) {
        next.set("sort", "latest")
        if (cursor) next.set("cursor", cursor)
      }
      const result = await api<CatalogResponse>(`/api/catalog/products?${next}`)
      setResponse(result)
      setPage(nextPage)
      updateUrl(nextQuery, nextFilters, nextLimit)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load source catalog products.")
    } finally {
      setLoading(false)
    }
  }

  async function loadFacets() {
    if (facetsLoading || Object.keys(facets).length) return
    setFacetsLoading(true)
    try {
      const result = await api<SourceCatalogFacets>("/api/catalog/facets")
      setFacets(result)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load source filter values.")
    } finally {
      setFacetsLoading(false)
    }
  }

  useEffect(() => {
    setLatestCursorStack([""])
    setSelectedSkus(new Set())
    setAllFiltered(false)
    void loadCatalog(1, "", query, filters, pageSize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize])

  useEffect(() => { if (filterOpen || quickFilterOpen) void loadFacets() }, [filterOpen, quickFilterOpen])

  useEffect(() => {
    if (promotionOpen) void openPromotion(promotionScope, promotionSkus, importMode)
    // The import mode changes the projected result without changing the user's selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importMode])

  function toggleSku(sku: string, checked: boolean) {
    setAllFiltered(false)
    setSelectedSkus((current) => {
      const next = new Set(current)
      if (checked) next.add(sku)
      else next.delete(sku)
      return next
    })
  }

  function applyFilters() {
    setFilters(filterDraft)
    setLatestCursorStack([""])
    setSelectedSkus(new Set())
    setAllFiltered(false)
    setFilterOpen(false)
    void loadCatalog(1, "", query, filterDraft)
  }

  function clearFilters() {
    const next = { ...defaultFilters, suppliers: [] }
    setFilters(next)
    setFilterDraft(next)
    setLatestCursorStack([""])
    setSelectedSkus(new Set())
    setAllFiltered(false)
    void loadCatalog(1, "", query, next)
  }

  function applyQuickFilter() {
    if (!quickFilterSelection.length) return
    const next = { ...filters }
    if (quickFilterField === "suppliers") next.suppliers = quickFilterSelection
    else next[quickFilterField as Exclude<keyof SourceCatalogFilters, "suppliers">] = quickFilterSelection[quickFilterSelection.length - 1]
    setFilters(next)
    setFilterDraft(next)
    setLatestCursorStack([""])
    setSelectedSkus(new Set())
    setAllFiltered(false)
    setQuickFilterOpen(false)
    setQuickFilterSelection([])
    setQuickFilterSearch("")
    void loadCatalog(1, "", query, next)
  }

  async function openPromotion(scope: "selected" | "filtered", explicitSkus?: string[], mode = importMode) {
    const skus = explicitSkus || [...selectedSkusRef.current]
    if (scope === "selected" && !skus.length) return
    setPromotionScope(scope)
    setPromotionSkus(skus)
    setPromotionOpen(true)
    setPromotionLoading(true)
    try {
      const result = await api<{ matched?: number; importable?: number; newProducts?: number; existing?: number; limited?: boolean; batchLimit?: number }>("/api/catalog/import-impact", { method: "POST", body: JSON.stringify({ skus, allFiltered: scope === "filtered", query, filters: filterPayload, importMode: mode }) })
      setPromotionImpact(result)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to calculate source catalog import impact.")
      setPromotionOpen(false)
    } finally {
      setPromotionLoading(false)
    }
  }

  async function promote() {
    setPromotionLoading(true)
    try {
      const result = await api<{ job?: ImportJob; message?: string }>("/api/catalog/bulk", { method: "POST", body: JSON.stringify({ action: "add-active", skus: promotionSkus, allFiltered: promotionScope === "filtered", query, filters: filterPayload, importMode }) })
      toast.success(result.message || "Source catalog import queued.")
      setPromotionOpen(false)
      setSelectedSkus(new Set())
      setAllFiltered(false)
      if (result.job?.id) window.setTimeout(() => { window.history.pushState({}, "", "/jobs"); window.dispatchEvent(new PopStateEvent("popstate")) }, 500)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue the source catalog import.")
    } finally {
      setPromotionLoading(false)
    }
  }

  async function runBulk(action: "set-active" | "set-inactive" | "set-discontinued" | "delete", scope: "selected" | "filtered" = "selected", explicitSkus?: string[]) {
    const skus = explicitSkus || [...selectedSkusRef.current]
    if (scope === "selected" && !skus.length) return
    const label = action === "delete" ? "hide" : action.replace("set-", "mark ")
    const count = scope === "filtered" ? total : skus.length
    if (!window.confirm(`${label.charAt(0).toUpperCase()}${label.slice(1)} ${numberLabel(count)} source SKU${count === 1 ? "" : "s"}?`)) return
    try {
      const result = await api<{ changed?: number }>("/api/catalog/bulk", { method: "POST", body: JSON.stringify({ action, skus, allFiltered: scope === "filtered", query, filters: filterPayload }) })
      toast.success(`${numberLabel(result.changed || 0)} source SKU${Number(result.changed || 0) === 1 ? "" : "s"} updated.`)
      setSelectedSkus(new Set())
      setAllFiltered(false)
      void loadCatalog(1)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update source catalog records.")
    }
  }

  const suppliers = (facets.suppliers || []).filter((supplier) => supplier.trim().toLowerCase().startsWith(supplierSearch.trim().toLowerCase())).slice(0, 250)

  return <div className="grid gap-5">
    <PageHeader eyebrow="Catalog" title="Source Catalog" description="Supplier feed records. Filter and review here before intentionally promoting a SKU into the approved catalog." action={<div className="flex gap-2"><DropdownMenu open={quickFilterOpen} onOpenChange={setQuickFilterOpen}><DropdownMenuTrigger asChild><Button variant="outline" size="sm"><Search className="size-4" /> + Filter{filterCount ? ` (${filterCount})` : ""}</Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-[380px] p-3"><div className="grid gap-3"><p className="text-xs font-semibold uppercase text-muted-foreground">Add source catalog filter</p><div className="grid gap-1"><Label className="text-xs">Field</Label><Select value={quickFilterField} onValueChange={(value) => { setQuickFilterField(value); setQuickFilterSelection([]); setQuickFilterSearch("") }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(quickFilterDefinitions).map(([key, definition]) => <SelectItem key={key} value={key}>{definition.label}</SelectItem>)}</SelectContent></Select></div><div className="grid gap-1"><Label className="text-xs">Operator</Label><Input value="Is any of" disabled /></div><div className="grid gap-1"><Label className="text-xs">Value</Label><div className="relative"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search values" value={quickFilterSearch} onChange={(event) => setQuickFilterSearch(event.target.value)} /></div></div><div className="max-h-52 overflow-y-auto rounded-md border">{quickValues.map((value) => <label key={value} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted"><Checkbox checked={quickFilterSelection.includes(value)} onCheckedChange={() => setQuickFilterSelection((current) => { if (quickDefinition.multiple) return current.includes(value) ? current.filter((item) => item !== value) : [...current, value]; return current.includes(value) ? [] : [value] })} />{quickDefinition.display(value)}</label>)}{!quickValues.length && <p className="p-3 text-sm text-muted-foreground">No values found.</p>}</div><div className="flex justify-between gap-2"><Button variant="ghost" size="sm" onClick={() => { setFilterDraft(filters); setFilterOpen(true); setQuickFilterOpen(false) }}>More filters</Button><div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setQuickFilterOpen(false)}>Cancel</Button><Button size="sm" onClick={applyQuickFilter} disabled={!quickFilterSelection.length}>Apply filter</Button></div></div></div></DropdownMenuContent></DropdownMenu><Button variant="outline" size="sm" onClick={() => { setFilterDraft(filters); setFilterOpen(true) }}>More filters</Button></div>} />
    <Card>
      <CardHeader className="gap-3 border-b">
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="relative"><Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" /><Input className="w-[420px] max-w-[72vw] pl-8" placeholder="Search SKU, title, brand, supplier, category" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setLatestCursorStack([""]); void loadCatalog(1) } }} /></div><div className="flex items-center gap-2"><Button size="sm" onClick={() => { setLatestCursorStack([""]); void loadCatalog(1) }} disabled={loading}>{loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Search</Button><Select value={String(pageSize)} onValueChange={(value) => setPageSize(Number(value))}><SelectTrigger className="w-28"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="10">10 rows</SelectItem><SelectItem value="25">25 rows</SelectItem><SelectItem value="50">50 rows</SelectItem><SelectItem value="100">100 rows</SelectItem></SelectContent></Select></div></div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>{numberLabel(total)} matched</span><span>Source: {response.database || response.manifest?.source || "catalog"}</span>{response.manifest?.importedAt && <span>Imported {dateLabel(response.manifest.importedAt)}</span>}{response.partial && <Badge variant="outline">Partial search</Badge>}{filterCount ? <><Badge variant="secondary">{filterCount} active filter{filterCount === 1 ? "" : "s"}</Badge><Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button></> : null}</div>
        {selectedCount ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2"><p className="text-sm font-medium">{allFiltered ? `${numberLabel(total)} filtered source SKUs selected` : `${numberLabel(selectedSkus.size)} source SKU${selectedSkus.size === 1 ? "" : "s"} selected`}</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => { setSelectedSkus(new Set()); setAllFiltered(false) }}>Clear</Button><Button size="sm" onClick={() => void openPromotion(allFiltered ? "filtered" : "selected")}>Add to main catalog</Button><DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline">Update status</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => void runBulk("set-active", allFiltered ? "filtered" : "selected")}>Set active</DropdownMenuItem><DropdownMenuItem onClick={() => void runBulk("set-inactive", allFiltered ? "filtered" : "selected")}>Set inactive</DropdownMenuItem><DropdownMenuItem onClick={() => void runBulk("set-discontinued", allFiltered ? "filtered" : "selected")}>Mark discontinued</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" onClick={() => void runBulk("delete", allFiltered ? "filtered" : "selected")}>Hide from source catalog</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div> : null}
      </CardHeader>
      <CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="w-10"><Checkbox aria-label="Select page" checked={pageSelected} onCheckedChange={(checked) => { if (checked) { setSelectedSkus(new Set(pageSkus)); setAllFiltered(false) } else { setSelectedSkus(new Set()); setAllFiltered(false) } }} /></TableHead><TableHead>Source product</TableHead><TableHead>Supplier</TableHead><TableHead>Manufacturer</TableHead><TableHead>Category</TableHead><TableHead>Stock</TableHead><TableHead>Cost</TableHead><TableHead>Price</TableHead><TableHead>Status</TableHead><TableHead className="w-12" /></TableRow></TableHeader><TableBody>{loading ? <TableRow><TableCell colSpan={10} className="py-12 text-center"><Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" /></TableCell></TableRow> : rows.map((item) => <TableRow key={`${item.supplier || ""}-${item.id || item.sku}`}><TableCell><Checkbox aria-label={`Select ${item.sku}`} checked={allFiltered || Boolean(item.sku && selectedSkus.has(item.sku))} onCheckedChange={(checked) => item.sku && toggleSku(item.sku, checked === true)} /></TableCell><TableCell><button className="flex min-w-64 items-center gap-3 text-left" onClick={() => setSelectedItem(item)}><div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md border bg-muted">{item.defaultImage ? <img src={item.defaultImage} alt="" className="max-h-full max-w-full object-contain" /> : <Boxes className="size-4 text-muted-foreground" />}</div><div className="min-w-0"><p className="truncate font-semibold hover:underline">{item.sku}</p><p className="line-clamp-1 text-xs text-muted-foreground">{item.title || "Untitled product"}</p>{item.inProducts && <Badge variant="secondary" className="mt-1">In products</Badge>}</div></button></TableCell><TableCell><p className="font-medium">{item.supplier || item.supplierCode || "Unknown"}</p><p className="text-xs text-muted-foreground">{item.brand || "No brand"}</p></TableCell><TableCell className="max-w-44"><p className="truncate">{item.manufacturer || item.vendorSku || "-"}</p></TableCell><TableCell className="max-w-72"><p className="line-clamp-2 text-sm">{item.mainCategory || item.sourceCategory || "Uncategorized"}</p><Badge variant={item.categoryVerified ? "default" : "outline"}>{item.categoryVerified ? "Mapped" : "Needs map"}</Badge></TableCell><TableCell><p className="font-medium">{numberLabel(item.stockQty)}</p><p className="text-xs text-muted-foreground">{item.stockStatus || "-"}</p></TableCell><TableCell>{moneyLabel(item.cost)}</TableCell><TableCell>{moneyLabel(item.websitePrice || item.price)}</TableCell><TableCell><div className="flex flex-col gap-1"><Badge variant={item.active === false ? "outline" : "default"}>{item.active === false ? "Inactive" : "Active"}</Badge>{item.toBeDiscontinued && <Badge variant="destructive">Discontinued</Badge>}</div></TableCell><TableCell><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" title="Source SKU actions"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onClick={() => setSelectedItem(item)}>View source details</DropdownMenuItem><DropdownMenuItem onClick={() => { if (item.sku) { setSelectedSkus(new Set([item.sku])); void openPromotion("selected") } }}>Add to main catalog</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onClick={() => { if (item.sku) { setSelectedSkus(new Set([item.sku])); void runBulk("set-active") } }}>Set active</DropdownMenuItem><DropdownMenuItem onClick={() => { if (item.sku) { setSelectedSkus(new Set([item.sku])); void runBulk("set-inactive") } }}>Set inactive</DropdownMenuItem><DropdownMenuItem onClick={() => { if (item.sku) { setSelectedSkus(new Set([item.sku])); void runBulk("set-discontinued") } }}>Mark discontinued</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-destructive" onClick={() => { if (item.sku) { setSelectedSkus(new Set([item.sku])); void runBulk("delete") } }}>Hide from source catalog</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell></TableRow>)}{!loading && !rows.length && <TableRow><TableCell colSpan={10} className="h-28 text-center text-muted-foreground">No source products match these filters.</TableCell></TableRow>}</TableBody></Table></div></CardContent>
    </Card>
    {pageSelected && !allFiltered && total > rows.length && <div className="flex justify-center"><Button size="sm" variant="outline" onClick={() => setAllFiltered(true)}>Select all {numberLabel(total)} filtered source SKUs</Button></div>}
    <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{latestMode ? `Page ${page}${response.hasMore ? " / more available" : ""}` : `Page ${page} of ${totalPages}`}</p><div className="flex gap-2"><Button variant="outline" disabled={page <= 1 || loading} onClick={() => { const previousCursor = latestMode ? (latestCursorStack[page - 2] || "") : ""; if (latestMode) setLatestCursorStack((current) => current.slice(0, Math.max(1, page - 1))); void loadCatalog(Math.max(1, page - 1), previousCursor) }}>Previous</Button><Button variant="outline" disabled={loading || (latestMode ? !response.nextCursor : page >= totalPages)} onClick={() => { if (latestMode) { const nextCursor = response.nextCursor || ""; setLatestCursorStack((current) => [...current.slice(0, page), nextCursor]); void loadCatalog(page + 1, nextCursor); return } void loadCatalog(Math.min(totalPages, page + 1)) }}>Next</Button></div></div>
    <Sheet open={filterOpen} onOpenChange={setFilterOpen}><SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl"><SheetHeader><SheetTitle>Source catalog filters</SheetTitle><SheetDescription>Filter values load only when this panel opens, keeping the catalog fast.</SheetDescription></SheetHeader>{facetsLoading ? <div className="grid gap-3 py-6"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div> : <div className="grid gap-5 py-6"><div className="grid gap-2"><Label>Supplier</Label><Input value={supplierSearch} onChange={(event) => setSupplierSearch(event.target.value)} placeholder="Find a supplier" /><div className="max-h-52 overflow-y-auto rounded-md border">{suppliers.map((supplier) => <label key={supplier} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted"><Checkbox checked={filterDraft.suppliers.includes(supplier)} onCheckedChange={() => setFilterDraft((current) => ({ ...current, suppliers: current.suppliers.includes(supplier) ? current.suppliers.filter((item) => item !== supplier) : [...current.suppliers, supplier] }))} />{supplier}</label>)}{!suppliers.length && <p className="p-3 text-sm text-muted-foreground">No suppliers match.</p>}</div></div><div className="grid gap-3 sm:grid-cols-2"><Field label="Catalog membership"><Select value={filterDraft.productMembership || "all"} onValueChange={(value) => setFilterDraft((current) => ({ ...current, productMembership: value === "all" ? "" : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All source SKUs</SelectItem><SelectItem value="in-products">Already in Products</SelectItem><SelectItem value="not-in-products">Source only</SelectItem></SelectContent></Select></Field><Field label="Stock"><Select value={filterDraft.hasStock || "all"} onValueChange={(value) => setFilterDraft((current) => ({ ...current, hasStock: value === "all" ? "" : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any stock</SelectItem><SelectItem value="true">In stock</SelectItem><SelectItem value="false">Out of stock</SelectItem></SelectContent></Select></Field><Field label="Lifecycle"><Select value={filterDraft.toBeDiscontinued || "all"} onValueChange={(value) => setFilterDraft((current) => ({ ...current, toBeDiscontinued: value === "all" ? "" : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any lifecycle</SelectItem><SelectItem value="false">Current</SelectItem><SelectItem value="true">Discontinued / closeout</SelectItem></SelectContent></Select></Field><Field label="Record status"><Select value={filterDraft.active || "all"} onValueChange={(value) => setFilterDraft((current) => ({ ...current, active: value === "all" ? "" : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any status</SelectItem><SelectItem value="true">Active</SelectItem><SelectItem value="false">Inactive</SelectItem></SelectContent></Select></Field><Field label="Hazardous"><Select value={filterDraft.hazardous || "all"} onValueChange={(value) => setFilterDraft((current) => ({ ...current, hazardous: value === "all" ? "" : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any compliance state</SelectItem><SelectItem value="true">Hazardous</SelectItem><SelectItem value="false">Not hazardous</SelectItem></SelectContent></Select></Field><Field label="Stock status"><Select value={filterDraft.stockStatus || "all"} onValueChange={(value) => setFilterDraft((current) => ({ ...current, stockStatus: value === "all" ? "" : value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Any stock status</SelectItem>{(facets.stockStatuses || []).map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select></Field></div><div className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_110px]"><Field label="Stock quantity"><Select value={filterDraft.stockQtyOperator || "all"} onValueChange={(value) => setFilterDraft((current) => ({ ...current, stockQtyOperator: value === "all" ? "" : value }))}><SelectTrigger><SelectValue placeholder="Operator" /></SelectTrigger><SelectContent><SelectItem value="all">Any quantity</SelectItem><SelectItem value="gt">Greater than</SelectItem><SelectItem value="gte">At least</SelectItem><SelectItem value="lt">Less than</SelectItem><SelectItem value="lte">At most</SelectItem><SelectItem value="empty">Missing</SelectItem></SelectContent></Select></Field><Field label="Value"><Input type="number" value={filterDraft.stockQty} disabled={!filterDraft.stockQtyOperator || ["empty", "notEmpty"].includes(filterDraft.stockQtyOperator)} onChange={(event) => setFilterDraft((current) => ({ ...current, stockQty: event.target.value }))} /></Field></div><div className="grid gap-3"><Field label="Brand"><Select value={filterDraft.brand || "all"} onValueChange={(value) => setFilterDraft((current) => ({ ...current, brand: value === "all" ? "" : value }))}><SelectTrigger><SelectValue placeholder="Any brand" /></SelectTrigger><SelectContent><SelectItem value="all">Any brand</SelectItem>{(facets.brands || []).map((brand) => <SelectItem key={brand} value={brand}>{brand}</SelectItem>)}</SelectContent></Select></Field><Field label="Category"><Select value={filterDraft.category || "all"} onValueChange={(value) => setFilterDraft((current) => ({ ...current, category: value === "all" ? "" : value }))}><SelectTrigger><SelectValue placeholder="Any category" /></SelectTrigger><SelectContent><SelectItem value="all">Any category</SelectItem>{(facets.categories || []).map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent></Select></Field><Field label="Manufacturer"><Input value={filterDraft.manufacturer} placeholder="Exact manufacturer" onChange={(event) => setFilterDraft((current) => ({ ...current, manufacturer: event.target.value }))} /></Field></div></div>}<SheetFooter><Button variant="outline" onClick={() => { const next = { ...defaultFilters, suppliers: [] }; setSupplierSearch(""); setFilterDraft(next) }}>Reset</Button><Button onClick={applyFilters} disabled={facetsLoading}>Apply filters</Button></SheetFooter></SheetContent></Sheet>
    <Dialog open={promotionOpen} onOpenChange={setPromotionOpen}><DialogContent><DialogHeader><DialogTitle>Add source SKUs to Products</DialogTitle><DialogDescription>This queues a tracked import. The source records remain intact and the job will record every change.</DialogDescription></DialogHeader>{promotionLoading ? <div className="grid place-items-center py-10"><Loader2 className="size-6 animate-spin" /></div> : <div className="grid gap-4"><div className="grid gap-3 sm:grid-cols-3"><Detail label="Matched" value={numberLabel(promotionImpact?.matched)} /><Detail label="New" value={numberLabel(promotionImpact?.newProducts)} /><Detail label="Existing" value={numberLabel(promotionImpact?.existing)} /></div>{promotionImpact?.limited && <Alert><AlertCircle className="size-4" /><AlertTitle>Import limit applies</AlertTitle><AlertDescription>Large all-filtered imports are capped at 25,000 source records per job.</AlertDescription></Alert>}<Field label="Import mode"><Select value={importMode} onValueChange={setImportMode}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new-and-update">New + update existing</SelectItem><SelectItem value="new-only">New only</SelectItem><SelectItem value="update-existing">Update existing only</SelectItem></SelectContent></Select></Field></div>}<DialogFooter><Button variant="outline" onClick={() => setPromotionOpen(false)}>Cancel</Button><Button onClick={() => void promote()} disabled={promotionLoading || !promotionImpact?.importable}>{promotionLoading && <Loader2 className="size-4 animate-spin" />} Queue import</Button></DialogFooter></DialogContent></Dialog>
    <ProductDetailSheet sourceItem={selectedItem} open={Boolean(selectedItem)} onOpenChange={(nextOpen) => { if (!nextOpen) setSelectedItem(null) }} />
  </div>
}
