import { lazy, useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, AlertTriangle, Archive, ArrowUpDown, Boxes, CalendarDays, CheckCircle2, ChevronDown, FileDown, FileText, History, ListChecks, Loader2, MoreHorizontal, Play, RefreshCw, RotateCcw, Search, ShieldCheck, ShoppingBag, SlidersHorizontal, Store, Truck, X } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Calendar } from "@/components/ui/calendar"
import { Checkbox } from "@/components/ui/checkbox"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { BulkSearchActions } from "./bulk-search-csv-button"
import { ImportDashboard } from "./import-dashboard"
import { OrderReturnDetails } from "./order-return-details"
import { Detail, Field, MetricCard, PageHeader } from "./app-ui"
import { EBAY_LIVE_FILTER_VALUE, TIKTOK_LIVE_FILTER_VALUE, EbayLiveMark, TikTokLiveMark, isEbayLiveOrder, isTikTokLiveOrder, orderChannelFilterLabel, orderChannelFilterValue } from "./ebay-live-mark"
import { api, dateLabel, moneyLabel, numberLabel } from "../lib/client-api"
import { matchesSearch, normalizePastedSearch, parseSearchTerms } from "../lib/multi-search"
import { readWorkspaceCache, writeWorkspaceCache } from "../lib/workspace-cache"
import {
  localDateKey, orderDateRangeBounds, orderDateRangeOptions, orderHref,
} from "../App"
import {
  OrderListPreview, getOrderRoutingState, isDoneOrderRow, orderHasBlockingException,
  orderListSearchText, trackingUrlForShipment,
} from "./order-workspaces"
import { rmaHref } from "./product-workspaces"
import type { LiteState } from "../App"

const ReturnsWorkspace = lazy(() => import("./returns-workspace").then((module) => ({ default: module.ReturnsWorkspace })))

type OrderMultiSelectOption = { value: string; label: string }

function normalizeOrderFilterValue(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase()
  return normalized === "cancelled" ? "canceled" : normalized
}

function orderFilterValues(value: unknown) {
  return [...new Set(String(value || "")
    .split(",")
    .map(normalizeOrderFilterValue)
    .filter((entry) => entry && entry !== "all"))]
}

function serializeOrderFilterValues(values: string[]) {
  const normalized = [...new Set(values.map(normalizeOrderFilterValue).filter(Boolean))]
  return normalized.length ? normalized.join(",") : "all"
}

function orderFilterLabel(value: unknown) {
  const normalized = normalizeOrderFilterValue(value)
  if (normalized === "canceled") return "Canceled"
  return normalized.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

function OrderMultiSelect({ value, onValueChange, options, placeholder, searchPlaceholder = "Search options" }: { value: string; onValueChange: (value: string) => void; options: OrderMultiSelectOption[]; placeholder: string; searchPlaceholder?: string }) {
  const selected = orderFilterValues(value)
  const normalizedOptions = [...new Map(options.map((option) => {
    const normalizedValue = normalizeOrderFilterValue(option.value)
    return [normalizedValue, { ...option, value: normalizedValue }]
  })).values()]
  const selectedLabels = selected.map((selectedValue) => normalizedOptions.find((option) => option.value === selectedValue)?.label || orderFilterLabel(selectedValue))
  const buttonLabel = selectedLabels.length === 0 ? placeholder : selectedLabels.length === 1 ? selectedLabels[0] : `${selectedLabels.length} selected`
  const toggleValue = (nextValue: string) => {
    const normalizedValue = normalizeOrderFilterValue(nextValue)
    const next = selected.includes(normalizedValue) ? selected.filter((entry) => entry !== normalizedValue) : [...selected, normalizedValue]
    onValueChange(serializeOrderFilterValues(next))
  }
  return <Popover>
    <PopoverTrigger asChild><Button type="button" variant="outline" className="w-full justify-between font-normal"><span className="truncate">{buttonLabel}</span><ChevronDown className="size-4 shrink-0 text-muted-foreground" /></Button></PopoverTrigger>
    <PopoverContent align="start" className="w-[min(19rem,calc(100vw-2rem))] p-0">
      <Command>
        <CommandInput placeholder={searchPlaceholder} />
        <CommandList>
          <CommandEmpty>No matching options.</CommandEmpty>
          <CommandGroup>
            <CommandItem value={`${placeholder} all any clear`} onSelect={() => onValueChange("all")}><Checkbox checked={selected.length === 0} tabIndex={-1} /><span>{placeholder}</span></CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup>
            {normalizedOptions.map((option) => <CommandItem key={option.value} value={`${option.label} ${option.value}`} onSelect={() => toggleValue(option.value)}><Checkbox checked={selected.includes(option.value)} tabIndex={-1} /><span>{option.label}</span></CommandItem>)}
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
}

export function OperationsPage({ mobileReturns = false }: { mobileReturns?: boolean } = {}) {
  const [transactionReturn, setTransactionReturn] = useState<Record<string, unknown> | null>(null)
  const orderRequestRef = useRef(0)
  const orderSearchInitializedRef = useRef(false)
  const poCreationRequestIdsRef = useRef(new Map<string, string>())
  const initial = mobileReturns || window.location.pathname.startsWith("/returns") ? "returns" : window.location.pathname.startsWith("/drafts") ? "drafts" : "orders"
  const orderWorkspace = window.location.pathname === "/orders/all" ? "all" : "open"
  const [tab, setTab] = useState(initial)
  const [data, setData] = useState<{ orders?: Array<Record<string, unknown>>; orderDrafts?: Array<Record<string, unknown>>; returns?: Array<Record<string, unknown>>; metrics?: Record<string, unknown>; scope?: string; dateFrom?: string; limit?: number; total?: number; page?: number; pageSize?: number; totalPages?: number }>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState("")
  const [queue, setQueue] = useState("all")
  const [status, setStatus] = useState("all")
  const [source, setSource] = useState("all")
  const [orderDateRange, setOrderDateRange] = useState("last7")
  const [orderDate, setOrderDate] = useState("")
  const [orderDateTo, setOrderDateTo] = useState("")
  const [appliedOrderDateRange, setAppliedOrderDateRange] = useState("last7")
  const [appliedOrderDate, setAppliedOrderDate] = useState("")
  const [appliedOrderDateTo, setAppliedOrderDateTo] = useState("")
  const [dateRangeOpen, setDateRangeOpen] = useState(false)
  const [orderAdvancedFilterOpen, setOrderAdvancedFilterOpen] = useState(false)
  const [orderAdvancedFilterField, setOrderAdvancedFilterField] = useState("fulfillment")
  const [sharedOrderViews, setSharedOrderViews] = useState<Array<Record<string, unknown>>>([])
  const [activeOrderViewId, setActiveOrderViewId] = useState("")
  const [saveOrderViewOpen, setSaveOrderViewOpen] = useState(false)
  const [savedOrderViewName, setSavedOrderViewName] = useState("")
  const [orderExportOpen, setOrderExportOpen] = useState(false)
  const [orderExportMode, setOrderExportMode] = useState("summary")
  const [orderExportScope, setOrderExportScope] = useState("filtered")
  const [orderExportBusy, setOrderExportBusy] = useState(false)
  const [paymentFilter, setPaymentFilter] = useState("all")
  const [shippingFilter, setShippingFilter] = useState("all")
  const [fulfillmentFilter, setFulfillmentFilter] = useState("all")
  const [deliveryFilter, setDeliveryFilter] = useState("all")
  const [poFilter, setPoFilter] = useState("all")
  const [supplierFilter, setSupplierFilter] = useState("all")
  const [brandFilter, setBrandFilter] = useState("all")
  const [carrierFilter, setCarrierFilter] = useState("all")
  const [countryFilter, setCountryFilter] = useState("all")
  const [stateFilter, setStateFilter] = useState("all")
  const [warehouseFilter, setWarehouseFilter] = useState("all")
  const [labelFilter, setLabelFilter] = useState("all")
  const [returnFilter, setReturnFilter] = useState("all")
  const [exceptionFilter, setExceptionFilter] = useState("all")
  const [outcomeFilter, setOutcomeFilter] = useState("all")
  const [totalMinFilter, setTotalMinFilter] = useState("")
  const [totalMaxFilter, setTotalMaxFilter] = useState("")
  const [visibleAllColumns, setVisibleAllColumns] = useState<Set<string>>(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem("dataplus:all-orders-columns") || "[]") as string[]
      return stored.length ? new Set(stored) : new Set(["date", "customer", "fulfillBy", "channel", "total", "payment", "fulfillment", "items", "delivery"])
    } catch { return new Set(["date", "customer", "fulfillBy", "channel", "total", "payment", "fulfillment", "items", "delivery"]) }
  })
  const [sort, setSort] = useState("created-desc")
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null)
  const [detail] = useState<Record<string, unknown> | null>(null)
  const [hasOrderChannel, setHasOrderChannel] = useState(false)
  const [warehouses, setWarehouses] = useState<Array<Record<string, unknown>>>([])
  const [quoteOpen, setQuoteOpen] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnTotal, setReturnTotal] = useState(0)
  const [returnsRefreshKey, setReturnsRefreshKey] = useState(0)
  const [returnOrderSearch, setReturnOrderSearch] = useState("")
  const [returnOrderResults, setReturnOrderResults] = useState<Array<Record<string, unknown>>>([])
  const [returnOrderDetail, setReturnOrderDetail] = useState<Record<string, unknown> | null>(null)
  const [returnOrderSearching, setReturnOrderSearching] = useState(false)
  const [resequenceOpen, setResequenceOpen] = useState(false)
  const [resequencePreview, setResequencePreview] = useState<{ startNumber: number; orderCount: number; changedCount: number; nextOrderNumber: string; fingerprint: string; first: Array<{ orderId: string; oldOrderNumber: string; newOrderNumber: string; orderAt?: string }>; last: Array<{ orderId: string; oldOrderNumber: string; newOrderNumber: string; orderAt?: string }> } | null>(null)
  const [resequenceLoading, setResequenceLoading] = useState(false)
  const [resequenceConfirmed, setResequenceConfirmed] = useState(false)
  const [historicalBackfillOpen, setHistoricalBackfillOpen] = useState(false)
  const [historicalBackfillConfirmed, setHistoricalBackfillConfirmed] = useState(false)
  const [historicalBackfillChannel, setHistoricalBackfillChannel] = useState("temu")
  const [historicalBackfillStart, setHistoricalBackfillStart] = useState(`${new Date().getFullYear()}-01-01`)
  const [historicalBackfillEnd, setHistoricalBackfillEnd] = useState(localDateKey(new Date()))
  const [historicalBackfillChannels, setHistoricalBackfillChannels] = useState<string[]>([])
  const [quoteForm, setQuoteForm] = useState({ buyer: "", buyerEmail: "", phone: "", source: "Manual", note: "", sku: "", title: "", qty: "1", price: "", line1: "", line2: "", city: "", state: "", postalCode: "", country: "US" })
  const [returnForm, setReturnForm] = useState({ orderId: "", warehouseId: "", reason: "Customer return", condition: "Unknown", note: "" })

  function currentOrderListFilters() {
    const activeRange = orderDateRangeBounds(appliedOrderDateRange, appliedOrderDate, appliedOrderDateTo)
    const hasSearch = query.trim().length >= 2
    return {
      q: query.trim(),
      status,
      source,
      payment: paymentFilter,
      shipping: shippingFilter,
      fulfillment: fulfillmentFilter,
      delivery: deliveryFilter,
      po: poFilter,
      supplier: supplierFilter,
      brand: brandFilter,
      carrier: carrierFilter,
      country: countryFilter,
      state: stateFilter,
      warehouse: warehouseFilter,
      label: labelFilter,
      returnStatus: returnFilter,
      exception: exceptionFilter,
      outcome: outcomeFilter,
      totalMin: totalMinFilter,
      totalMax: totalMaxFilter,
      dateFrom: hasSearch ? "" : activeRange.from,
      dateTo: hasSearch ? "" : activeRange.to,
      sort,
    }
  }

  function appendOrderListFilters(params: URLSearchParams) {
    const filters = currentOrderListFilters()
    Object.entries(filters).forEach(([key, value]) => {
      const normalized = String(value || "").trim()
      if (normalized && normalized !== "all") params.set(key, normalized)
    })
    if (!filters.q && appliedOrderDateRange === "allTime") params.set("allDates", "1")
  }

  async function load() {
    const requestId = ++orderRequestRef.current
    try {
      if (tab === "returns") {
        setLoading(true)
        const state = await api<LiteState>("/api/orders/references")
        if (requestId !== orderRequestRef.current) return
        setData({ orders: [], returns: [] })
        setHasOrderChannel((state.connections || []).some(c => c.name?.toLowerCase() === "shopify" && c.settings?.channelEnabled !== false))
        setWarehouses((state.warehouses || []) as Array<Record<string, unknown>>)
        return
      }
      if (tab === "drafts") {
        const cacheKey = "orders:drafts"
        const cached = readWorkspaceCache<typeof data>(cacheKey)
        if (cached) setData(cached)
        setLoading(!cached)
        const drafts = await api<{ orderDrafts?: Array<Record<string, unknown>> }>("/api/order-drafts")
        if (requestId !== orderRequestRef.current) return
        const nextData = { orderDrafts: drafts.orderDrafts || [] }
        setData(nextData)
        writeWorkspaceCache(cacheKey, nextData)
        return
      }
      const activeRange = orderDateRangeBounds(appliedOrderDateRange, appliedOrderDate, appliedOrderDateTo)
      const ordersPath = new URLSearchParams({ summary: "1", limit: "5000", recentDays: "7", includeOpenWork: orderWorkspace === "open" ? "1" : "0" })
      if (orderWorkspace === "open") ordersPath.set("openWorkOnly", "1")
      const serverSearch = query.trim()
      if (orderWorkspace === "all") {
        ordersPath.set("page", String(page))
        ordersPath.set("pageSize", "100")
        appendOrderListFilters(ordersPath)
      } else if (serverSearch.length >= 2) {
        ordersPath.set("q", serverSearch)
        ordersPath.set("limit", "10000")
      } else if (activeRange.from) {
        ordersPath.set("dateFrom", activeRange.from)
      }
      const cacheKey = `orders:list:${orderWorkspace}:${ordersPath.toString()}`
      const cached = readWorkspaceCache<typeof data>(cacheKey)
      if (cached) setData(cached)
      setLoading(!cached)
      const [orders, state] = await Promise.all([
        api<{ orders?: Array<Record<string, unknown>>; orderDrafts?: Array<Record<string, unknown>>; returns?: Array<Record<string, unknown>>; metrics?: Record<string, unknown>; scope?: string; q?: string; dateFrom?: string; limit?: number; total?: number; page?: number; pageSize?: number; totalPages?: number }>(`/api/orders?${ordersPath.toString()}`),
        api<LiteState>("/api/orders/references"),
      ])
      if (requestId !== orderRequestRef.current) return
      setData(orders)
      writeWorkspaceCache(cacheKey, orders)
      const enabledOrderChannels = (state.connections || []).filter((connection) => connection.settings?.channelEnabled !== false).map((connection) => {
        const name = String(connection.name || "").toLowerCase()
        return name.includes("walmart") ? "walmart" : name.includes("shopify") ? "shopify" : name.includes("ebay") ? "ebay" : name.includes("temu") ? "temu" : name
      })
      setHistoricalBackfillChannels(enabledOrderChannels)
      setHasOrderChannel(enabledOrderChannels.includes("shopify"))
      setWarehouses((state.warehouses || []) as Array<Record<string, unknown>>)
    }
    catch (error) { if (requestId === orderRequestRef.current) toast.error(error instanceof Error ? error.message : "Unable to load operations data.") }
    finally { if (requestId === orderRequestRef.current) setLoading(false) }
  }
  useEffect(() => { void load() }, [tab, appliedOrderDateRange, appliedOrderDate, appliedOrderDateTo, orderWorkspace, page, sort, status, source, paymentFilter, shippingFilter, fulfillmentFilter, deliveryFilter, poFilter, supplierFilter, brandFilter, carrierFilter, countryFilter, stateFilter, warehouseFilter, labelFilter, returnFilter, exceptionFilter, outcomeFilter, totalMinFilter, totalMaxFilter])
  useEffect(() => {
    if (!returnOpen || returnOrderDetail || returnOrderSearch.trim().length < 2) {
      if (!returnOrderDetail) setReturnOrderResults([])
      return
    }
    let active = true
    const handle = window.setTimeout(async () => {
      setReturnOrderSearching(true)
      try {
        const result = await api<{ results?: Array<Record<string, unknown>> }>(`/api/quick-search/operations?q=${encodeURIComponent(returnOrderSearch.trim())}&limit=10`)
        if (active) setReturnOrderResults((result.results || []).filter((entry) => String(entry.type || "") === "order"))
      } catch {
        if (active) setReturnOrderResults([])
      } finally {
        if (active) setReturnOrderSearching(false)
      }
    }, 200)
    return () => { active = false; window.clearTimeout(handle) }
  }, [returnOpen, returnOrderSearch, returnOrderDetail])
  useEffect(() => {
    if (tab !== "orders") return
    if (!orderSearchInitializedRef.current) {
      orderSearchInitializedRef.current = true
      return
    }
    const serverSearch = query.trim()
    if (serverSearch.length === 1) return
    const handle = window.setTimeout(() => { void load() }, 350)
    return () => window.clearTimeout(handle)
  }, [query, tab])
  useEffect(() => {
    if (tab !== "orders" || orderWorkspace !== "all") return
    let active = true
    void api<{ views?: Array<Record<string, unknown>> }>("/api/orders/views")
      .then((result) => { if (active) setSharedOrderViews(result.views || []) })
      .catch(() => { if (active) setSharedOrderViews([]) })
    return () => { active = false }
  }, [tab, orderWorkspace])
  useEffect(() => { setPage(1); setSelectedIds(new Set()) }, [tab, queue, status, source, appliedOrderDateRange, appliedOrderDate, appliedOrderDateTo, query, sort, paymentFilter, shippingFilter, fulfillmentFilter, deliveryFilter, poFilter, supplierFilter, brandFilter, carrierFilter, countryFilter, stateFilter, warehouseFilter, labelFilter, returnFilter, exceptionFilter, outcomeFilter, totalMinFilter, totalMaxFilter])
  useEffect(() => {
    window.localStorage.setItem("dataplus:all-orders-columns", JSON.stringify([...visibleAllColumns]))
  }, [visibleAllColumns])
  useEffect(() => {
    const handleAction = (event: Event) => {
      const action = (event as CustomEvent<{ action?: string }>).detail?.action
      if (action === "import-shopify") void importShopifyOrders()
      if (action === "refresh") void load()
    }
    window.addEventListener("dataplus:operations-action", handleAction)
    return () => window.removeEventListener("dataplus:operations-action", handleAction)
  }, [])

  async function importShopifyOrders() {
    setBusy(true)
    try {
      const result = await api<{ queued?: boolean; message?: string }>("/api/shopify/orders/import", { method: "POST", body: JSON.stringify({ limit: 250 }) })
      toast.success(result.message || "Shopify order import queued. Follow progress in Jobs.")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to import Shopify orders.") }
    finally { setBusy(false) }
  }
  async function importChannelReturns() {
    setBusy(true)
    const lookbackDays = Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 86400000) + 1
    const channels = ["temu", "shopify", "ebay", "walmart"]
    const results = await Promise.all(channels.map(async (channel) => {
      try {
        const result = await api<{ job?: { id?: string }; duplicate?: boolean; message?: string }>(`/api/${channel}/returns/import`, { method: "POST", body: JSON.stringify({ lookbackDays, fetchAll: true }) })
        return { channel, ok: true, message: result.message || "Queued." }
      } catch (error) { return { channel, ok: false, message: error instanceof Error ? error.message : "Unable to queue return import." } }
    }))
    setBusy(false)
    const queued = results.filter((entry) => entry.ok)
    const failed = results.filter((entry) => !entry.ok)
    if (queued.length) toast.success(`${queued.map((entry) => entry.channel === "ebay" ? "eBay" : entry.channel[0].toUpperCase() + entry.channel.slice(1)).join(", ")} return sync queued. Follow progress in Jobs.`)
    if (failed.length) toast.error(`${failed.map((entry) => `${entry.channel}: ${entry.message}`).join(" ")}`)
  }
  async function queueOrderExport() {
    setOrderExportBusy(true)
    try {
      const result = await api<{ job?: { id?: string }; message?: string }>("/api/orders/export", {
        method: "POST",
        body: JSON.stringify({
          mode: orderExportMode,
          scope: orderExportScope,
          orderIds: orderExportScope === "selected" ? [...selectedIds] : [],
          filters: currentOrderListFilters(),
        }),
      })
      setOrderExportOpen(false)
      toast.success(result.message || "Order export queued. Download it from Jobs when it is ready.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue the order export.")
    } finally {
      setOrderExportBusy(false)
    }
  }
  async function openInternalNumberResequence() {
    setResequenceOpen(true)
    setResequenceConfirmed(false)
    setResequencePreview(null)
    setResequenceLoading(true)
    try {
      const preview = await api<typeof resequencePreview>("/api/orders/internal-number-resequence/preview")
      setResequencePreview(preview)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to prepare the internal-number resequence preview.")
      setResequenceOpen(false)
    } finally {
      setResequenceLoading(false)
    }
  }
  async function queueInternalNumberResequence() {
    if (!resequencePreview || !resequenceConfirmed) return
    setResequenceLoading(true)
    try {
      const result = await api<{ job?: { id?: string }; message?: string }>("/api/orders/internal-number-resequence", {
        method: "POST",
        body: JSON.stringify({ confirm: true, startNumber: resequencePreview.startNumber, fingerprint: resequencePreview.fingerprint }),
      })
      toast.success(result.message || "Internal-number resequence queued. Follow it in Jobs.")
      setResequenceOpen(false)
      if (result.job?.id) window.location.href = `/jobs/${encodeURIComponent(result.job.id)}`
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue the internal-number resequence.")
    } finally {
      setResequenceLoading(false)
    }
  }
  async function queueHistoricalBackfill() {
    const start = new Date(`${historicalBackfillStart}T00:00:00`)
    const end = new Date(`${historicalBackfillEnd}T23:59:59`)
    const startDay = Date.parse(`${historicalBackfillStart}T00:00:00Z`)
    const endDay = Date.parse(`${historicalBackfillEnd}T00:00:00Z`)
    const lookbackDays = Math.floor((endDay - startDay) / 86400000) + 1
    if (!Number.isFinite(lookbackDays) || lookbackDays < 1 || lookbackDays > 365) { toast.error("Choose a valid date range of no more than 365 days."); return }
    if (historicalBackfillChannel === "walmart" && lookbackDays > 180) { toast.error("Walmart historical imports must be run in date ranges of 180 days or less."); return }
    const path = historicalBackfillChannel === "walmart" ? "/api/walmart/orders/import" : `/api/${historicalBackfillChannel}/orders/import`
    setBusy(true)
    try {
      const result = await api<{ job?: { id?: string }; duplicate?: boolean; message?: string }>(path, {
        method: "POST",
        body: JSON.stringify({
          historicalBackfill: true,
          includeCanceled: true,
          fetchAll: true,
          lookbackDays,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        }),
      })
      toast.success(result.message || `${historicalBackfillChannel} historical backfill queued.`)
      setHistoricalBackfillOpen(false)
      setHistoricalBackfillConfirmed(false)
      if (result.job?.id) window.location.href = `/jobs/${encodeURIComponent(result.job.id)}`
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to queue the historical backfill.")
    } finally {
      setBusy(false)
    }
  }
  async function runAction(ids: string[], action: string) {
    if (!ids.length) return
    setBusy(true)
    try {
      for (const id of ids) await api(`/api/orders/${encodeURIComponent(id)}/action`, { method: "POST", body: JSON.stringify({ action }) })
      toast.success(`${ids.length.toLocaleString()} order${ids.length === 1 ? "" : "s"} updated.`)
      setSelectedIds(new Set())
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to update order.") }
    finally { setBusy(false) }
  }
  async function createBackorder(order: Record<string, unknown>) {
    setBusy(true)
    const orderId = String(order.id || "")
    const requestKey = `backorder:${orderId}`
    const requestId = poCreationRequestIdsRef.current.get(requestKey) || crypto.randomUUID()
    poCreationRequestIdsRef.current.set(requestKey, requestId)
    try {
      const result = await api<{ message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/backorder-po`, { method: "POST", body: JSON.stringify({ requestId }) })
      toast.success(result.message || "Backorder purchase order created.")
      poCreationRequestIdsRef.current.delete(requestKey)
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to create a backorder PO.") }
    finally { setBusy(false) }
  }
  async function createSupplierPos(orderIds: string[]) {
    if (!orderIds.length) return
    setBusy(true)
    const requestKey = `supplier-pos:${[...orderIds].sort().join(",")}`
    const requestId = poCreationRequestIdsRef.current.get(requestKey) || crypto.randomUUID()
    poCreationRequestIdsRef.current.set(requestKey, requestId)
    try {
      const result = await api<{ message?: string }>("/api/purchase-orders", { method: "POST", body: JSON.stringify({ requestId, orderIds, groupBySupplier: true, user: "Luis" }) })
      toast.success(result.message || "Supplier-specific purchase orders created.")
      poCreationRequestIdsRef.current.delete(requestKey)
      setSelectedIds(new Set())
      await load()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to create supplier purchase orders.") }
    finally { setBusy(false) }
  }
  async function refreshOrderRouting(orderId: string) {
    if (!orderId) return
    setBusy(true)
    try {
      const result = await api<{ message?: string }>(`/api/orders/${encodeURIComponent(orderId)}/route`, { method: "POST", body: JSON.stringify({ user: "Luis" }) })
      toast.success(result.message || "Order routing refreshed.")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to refresh order routing.")
    } finally {
      setBusy(false)
    }
  }
  async function createQuote() {
    const qty = Number(quoteForm.qty || 0)
    setBusy(true)
    try {
      const result = await api<{ draft?: Record<string, unknown> }>("/api/order-drafts", {
        method: "POST",
        body: JSON.stringify({
          buyer: quoteForm.buyer.trim(), buyerEmail: quoteForm.buyerEmail.trim(), phone: quoteForm.phone.trim(), source: quoteForm.source,
          note: quoteForm.note.trim(),
          shippingAddress: { name: quoteForm.buyer.trim(), line1: quoteForm.line1.trim(), line2: quoteForm.line2.trim(), city: quoteForm.city.trim(), state: quoteForm.state.trim(), postalCode: quoteForm.postalCode.trim(), country: quoteForm.country.trim() },
          items: quoteForm.sku.trim() && qty > 0 ? [{ sku: quoteForm.sku.trim(), title: quoteForm.title.trim() || quoteForm.sku.trim(), qty, price: Number(quoteForm.price || 0) }] : [],
        }),
      })
      setQuoteOpen(false)
      setQuoteForm({ buyer: "", buyerEmail: "", phone: "", source: "Manual", note: "", sku: "", title: "", qty: "1", price: "", line1: "", line2: "", city: "", state: "", postalCode: "", country: "US" })
      toast.success(`${String(result.draft?.draftNumber || "Quote")} created.`)
      const nextId = String(result.draft?.id || "")
      if (nextId) window.location.href = `/drafts/${encodeURIComponent(nextId)}?edit=1`
      else {
        window.history.replaceState({}, "", "/drafts")
        setTab("drafts")
        await load()
      }
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to create quote.") }
    finally { setBusy(false) }
  }
  async function duplicateDraft(draft: Record<string, unknown>) {
    setBusy(true)
    try { const result = await api<{ draft?: Record<string, unknown> }>(`/api/order-drafts/${encodeURIComponent(String(draft.id || ""))}/duplicate`, { method: "POST" }); toast.success(`${String(result.draft?.draftNumber || "Quote")} duplicated.`); await load() }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to duplicate quote.") }
    finally { setBusy(false) }
  }
  async function convertDraft(draft: Record<string, unknown>) {
    setBusy(true)
    try { const result = await api<{ order?: Record<string, unknown> }>(`/api/order-drafts/${encodeURIComponent(String(draft.id || ""))}/convert`, { method: "POST", body: JSON.stringify({ user: "Luis" }) }); toast.success("Quote converted to an order."); await load(); if (result.order) window.location.href = orderHref(result.order) }
    catch (error) { toast.error(error instanceof Error ? error.message : "Unable to convert quote.") }
    finally { setBusy(false) }
  }
  async function createReturn() {
    const order = returnOrderDetail
    if (!order || !returnForm.warehouseId) { toast.error("Choose an order and a return warehouse."); return }
    const items = (Array.isArray(order.items) ? order.items as Array<Record<string, unknown>> : []).map((line, lineIndex) => ({ sku: String(line.sku || ""), title: String(line.title || line.sku || ""), qty: Number(line.qty || 0), price: Number(line.price || 0), cost: Number(line.cost || line.unitCost || 0), lineIndex })).filter((line) => line.sku && line.qty > 0)
    if (!items.length) { toast.error("The selected order has no returnable line items."); return }
    setBusy(true)
    try {
      await api(`/api/orders/${encodeURIComponent(returnForm.orderId)}/returns`, { method: "POST", body: JSON.stringify({ warehouseId: returnForm.warehouseId, reason: returnForm.reason, condition: returnForm.condition, note: returnForm.note, amount: Number(order.total || 0), items, user: "Luis" }) })
      setReturnOpen(false); setReturnOrderSearch(""); setReturnOrderResults([]); setReturnOrderDetail(null); setReturnForm({ orderId: "", warehouseId: "", reason: "Customer return", condition: "Unknown", note: "" }); setTab("returns"); window.history.replaceState({}, "", mobileReturns ? "/warehouse/mobile/returns" : "/returns"); await load(); setReturnsRefreshKey((current) => current + 1); toast.success("Return created and ready for receiving.")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to create return.") }
    finally { setBusy(false) }
  }

  async function selectReturnOrder(result: Record<string, unknown>) {
    const orderId = String(result.id || "")
    if (!orderId) return
    setReturnOrderSearching(true)
    try {
      const detail = await api<{ order?: Record<string, unknown> }>(`/api/orders/${encodeURIComponent(orderId)}`)
      if (!detail.order) throw new Error("Order details could not be loaded.")
      setReturnOrderDetail(detail.order)
      setReturnOrderResults([])
      setReturnForm((current) => ({ ...current, orderId }))
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to load the order.") }
    finally { setReturnOrderSearching(false) }
  }

  const orderRows = data.orders || []
  const orderMetrics = data.metrics || {}
  const queueFor = (row: Record<string, unknown>) => {
    if (isDoneOrderRow(row)) return "done"
    if (orderHasBlockingException(row)) return "exceptions"
    if (getOrderRoutingState(row).needsRouting) return "not-routed"
    const workflow = String(row.operationalStatus || row.workflowStatus || "").toLowerCase()
    if (workflow) return ({ pending_payment: "new", payment_review: "review", processing: "processing", in_fulfillment: "processing", partially_fulfilled: "processing", on_hold: "review", completed: "done", canceled: "canceled" } as Record<string, string>)[workflow] || "processing"
    const orderStatus = String(row.status || "new").toLowerCase()
    const fulfillment = String(row.fulfillmentStatus || row.fulfillmentStage || "").toLowerCase()
    const shipments = Array.isArray(row.shipments) ? row.shipments as Array<Record<string, unknown>> : []
    const backorders = Array.isArray(row.backorderLines) ? row.backorderLines : []
    const items = Array.isArray(row.items) ? row.items as Array<Record<string, unknown>> : []
    if (["canceled", "cancelled", "void", "deleted"].includes(orderStatus)) return "canceled"
    const fullyFulfilled = ["fulfilled", "shipped", "delivered", "completed", "complete", "done", "closed"].includes(fulfillment)
    if (fullyFulfilled || shipments.some((item) => ["fulfilled", "shipped"].includes(String(item.status || "").toLowerCase()))) return "done"
    if (shipments.some((item) => String(item.status || "").toLowerCase() === "label_purchased")) return "ready-ship"
    if (backorders.length) return "waiting-po"
    if (orderStatus === "hold" || items.some((item) => String(item.sku || "") && !item.localProductId && !item.productId)) return "review"
    if (["approved", "confirmed", "processing"].includes(orderStatus)) return shipments.length ? "ready-ship" : "processing"
    return "new"
  }
  const queueDefinitions = [
    ["all", "All", "Recent orders plus open work"],
    ["new", "New", "Newly imported or pending orders"],
    ["processing", "Processing", "Approved orders needing an operational decision"],
    ["not-routed", "Not routed", "Paid open orders awaiting a warehouse or supplier routing decision"],
    ["waiting-po", "Waiting for PO", "Backordered orders awaiting supply"],
    ["ready-ship", "Ready to ship", "Allocated orders or purchased labels awaiting fulfillment"],
    ["exceptions", "Exceptions", "Orders blocked by missing inventory, supplier, package, or operational data"],
    ["review", "Review", "Hold, local-match, or exception work"],
    ["done", "Done", "Fulfilled or shipped orders"],
    ["canceled", "Canceled", "Canceled, voided, or deleted orders"],
  ] as const
  const counts = Object.fromEntries(queueDefinitions.map(([id]) => [id, id === "all" ? orderRows.length : orderRows.filter((row) => queueFor(row) === id).length])) as Record<string, number>
  const actionQueueIds = new Set(["new", "processing", "not-routed", "waiting-po", "ready-ship", "exceptions", "review"])
  const visibleQueueDefinitions = orderWorkspace === "open"
    ? queueDefinitions.filter(([id]) => id === "all" || actionQueueIds.has(id))
    : queueDefinitions
  const actionRequiredCount = orderRows.filter((row) => actionQueueIds.has(queueFor(row))).length
  const rows = tab === "orders" ? orderRows : tab === "drafts" ? data.orderDrafts || [] : data.returns || []
  const sourceValues = [...new Set([...rows.map(orderChannelFilterValue).filter(Boolean), ...(tab === "orders" ? ["Shopify", "eBay", "Temu", "TikTok Shop", "Walmart", "Manual", EBAY_LIVE_FILTER_VALUE, TIKTOK_LIVE_FILTER_VALUE] : [])])].sort((left, right) => orderChannelFilterLabel(left).localeCompare(orderChannelFilterLabel(right)))
  const statusValues = [...new Set([...rows.map((row) => normalizeOrderFilterValue(row.status || row.returnStatus)).filter(Boolean), ...(tab === "orders" ? ["new", "pending", "processing", "hold", "completed", "canceled", "refunded"] : [])])].sort((left, right) => left.localeCompare(right))
  const statusFilterOptions = statusValues.map((value) => ({ value, label: orderFilterLabel(value) }))
  const sourceFilterOptions = sourceValues.map((value) => ({ value, label: orderChannelFilterLabel(value) }))
  const paymentFilterOptions = [{ value: "paid", label: "Paid" }, { value: "partially_paid", label: "Partially paid" }, { value: "unpaid", label: "Unpaid" }, { value: "pending", label: "Pending" }, { value: "refunded", label: "Refunded" }]
  const shippingFilterOptions = [{ value: "unshipped", label: "Unshipped" }, { value: "label_purchased", label: "Label purchased" }, { value: "label_printed", label: "Label printed" }, { value: "partially_shipped", label: "Partially shipped" }, { value: "shipped", label: "Shipped" }, { value: "delivered", label: "Delivered" }]
  const fulfillmentFilterOptions = [{ value: "unfulfilled", label: "Unfulfilled" }, { value: "fulfilled", label: "Fulfilled" }, { value: "partial", label: "Partially fulfilled" }]
  const deliveryFilterOptions = [{ value: "delivered", label: "Delivered" }, { value: "in_transit", label: "In transit" }, { value: "shipped", label: "Shipped" }, { value: "no_tracking", label: "No tracking" }]
  const labelFilterOptions = [{ value: "no_label", label: "No label" }, { value: "purchased", label: "Purchased, not printed" }, { value: "printed", label: "Printed" }]
  const returnFilterOptions = [{ value: "has_return", label: "Has return" }, { value: "no_return", label: "No return" }, { value: "requested", label: "Requested" }, { value: "received", label: "Received" }]
  const outcomeFilterOptions = [{ value: "active", label: "Active / not canceled" }, { value: "canceled", label: "Canceled or voided" }, { value: "refunded", label: "Refunded" }]
  const exceptionFilterOptions = [{ value: "has_exception", label: "Has exception" }, { value: "no_exception", label: "No exception" }]
  const poFilterOptions = [{ value: "linked", label: "PO linked" }, { value: "unlinked", label: "No PO linked" }]
  const selectedFilterLabels = (value: string, options: OrderMultiSelectOption[]) => orderFilterValues(value).map((selectedValue) => options.find((option) => normalizeOrderFilterValue(option.value) === selectedValue)?.label || orderFilterLabel(selectedValue)).join(", ")
  const searchTerm = query.trim().toLowerCase()
  const searchTerms = parseSearchTerms(query)
  const orderDateFor = (row: Record<string, unknown>) => String(row.orderDate || row.orderedAt || row.purchaseDate || row.purchasedAt || row.createdAt || row.updatedAt || "")
  const activeDateRange = useMemo(() => orderDateRangeBounds(appliedOrderDateRange, appliedOrderDate, appliedOrderDateTo), [appliedOrderDateRange, appliedOrderDate, appliedOrderDateTo])
  const allOrderColumnOptions = [
    ["date", "Order date"], ["customer", "Customer"], ["fulfillBy", "Fulfill by"], ["channel", "Channel"], ["total", "Revenue total"], ["shipping", "Customer shipping"], ["labelCost", "Label cost"], ["profit", "Estimated profit"], ["payment", "Payment status"], ["fulfillment", "Fulfillment status"], ["items", "Items"], ["supplier", "Supplier"], ["po", "Purchase order"], ["carrier", "Carrier"], ["tracking", "Tracking"], ["delivery", "Delivery status"], ["destination", "Ship to"], ["updated", "Last updated"],
  ] as const
  const showAllColumn = (id: string) => orderWorkspace !== "all" || visibleAllColumns.has(id)
  const orderHasPo = (row: Record<string, unknown>) => (Array.isArray(row.purchaseOrderIds) && row.purchaseOrderIds.length > 0) || (Array.isArray(row.purchaseOrderNumbers) && row.purchaseOrderNumbers.length > 0) || (Array.isArray(row.fulfillmentRoutes) && (row.fulfillmentRoutes as Array<Record<string, unknown>>).some((route) => Boolean(route.purchaseOrderId)))
  const deliveryStateFor = (row: Record<string, unknown>) => String(row.deliveryStatus || row.trackingStatus || (Array.isArray(row.shipments) && row.shipments[0] ? (row.shipments[0] as Record<string, unknown>).status || "" : "") || "no_tracking").toLowerCase()
  const supplierFor = (row: Record<string, unknown>) => String(row.supplier || row.vendor || (Array.isArray(row.items) && row.items[0] ? (row.items[0] as Record<string, unknown>).supplier || (row.items[0] as Record<string, unknown>).vendor || "" : ""))
  const brandFor = (row: Record<string, unknown>) => String(row.brand || (Array.isArray(row.items) && row.items[0] ? (row.items[0] as Record<string, unknown>).brand || "" : ""))
  const shipmentFor = (row: Record<string, unknown>) => Array.isArray(row.shipments) && row.shipments[0] ? row.shipments[0] as Record<string, unknown> : {}
  const carrierFor = (row: Record<string, unknown>) => String(shipmentFor(row).carrier || shipmentFor(row).carrierName || row.carrier || "")
  const countryFor = (row: Record<string, unknown>) => String((row.shippingAddress as Record<string, unknown> | undefined)?.country || (row.shippingAddress as Record<string, unknown> | undefined)?.countryCode || row.shippingCountry || "")
  const stateFor = (row: Record<string, unknown>) => String((row.shippingAddress as Record<string, unknown> | undefined)?.state || (row.shippingAddress as Record<string, unknown> | undefined)?.province || "")
  const warehouseFor = (row: Record<string, unknown>) => String(row.fulfillmentWarehouseName || row.fulfillmentWarehouseId || (Array.isArray(row.fulfillmentRoutes) && row.fulfillmentRoutes[0] ? (row.fulfillmentRoutes[0] as Record<string, unknown>).warehouseName || (row.fulfillmentRoutes[0] as Record<string, unknown>).warehouseId || "" : ""))
  const activeShipmentsFor = (row: Record<string, unknown>) => (Array.isArray(row.shipments) ? row.shipments as Array<Record<string, unknown>> : []).filter((shipment) => !["canceled", "cancelled", "void", "voided", "superseded"].includes(String(shipment.status || "").toLowerCase()))
  const labelStateFor = (row: Record<string, unknown>) => {
    const shipments = activeShipmentsFor(row)
    if (shipments.some((shipment) => shipment.labelPrintedAt || shipment.labelLastPrintedAt || Number(shipment.labelPrintCount || 0) > 0)) return "printed"
    if (shipments.some((shipment) => shipment.labelPurchaseId || shipment.labelProvider || shipment.labelSource || (Array.isArray(shipment.documents) && shipment.documents.length > 0))) return "purchased"
    return "no_label"
  }
  const shippingStateFor = (row: Record<string, unknown>) => {
    const statuses = [row.deliveryStatus, row.trackingStatus, row.fulfillmentStatus, row.fulfillmentStage, row.status, ...activeShipmentsFor(row).flatMap((shipment) => [shipment.status, shipment.trackingStatus, shipment.carrierStatus])].map((value) => String(value || "").toLowerCase())
    if (row.deliveredAt || statuses.some((value) => value.includes("deliver"))) return "delivered"
    if (statuses.some((value) => value.includes("partial"))) return "partially_shipped"
    if (row.shippedAt || row.shipDate || statuses.some((value) => value.includes("ship") || value.includes("transit"))) return "shipped"
    const label = labelStateFor(row)
    return label === "printed" ? "label_printed" : label === "purchased" ? "label_purchased" : "unshipped"
  }
  const supplierValues = [...new Set(rows.map(supplierFor).filter(Boolean))].sort()
  const brandValues = [...new Set(rows.map(brandFor).filter(Boolean))].sort()
  const carrierValues = [...new Set(rows.map(carrierFor).filter(Boolean))].sort()
  const countryValues = [...new Set(rows.map(countryFor).filter(Boolean))].sort()
  const stateValues = [...new Set(rows.map(stateFor).filter(Boolean))].sort()
  const warehouseValues = [...new Set(rows.map(warehouseFor).filter(Boolean))].sort()
  const setDatePreset = (nextRange: string) => {
    const bounds = orderDateRangeBounds(nextRange)
    setOrderDateRange(nextRange)
    setOrderDate(bounds.from)
    setOrderDateTo(bounds.to)
  }
  const applyDateRange = () => {
    const nextRange = orderDateRange === "custom" && !orderDate && !orderDateTo ? "last7" : orderDateRange
    setAppliedOrderDateRange(nextRange)
    setAppliedOrderDate(orderDate)
    setAppliedOrderDateTo(orderDateTo)
    setDateRangeOpen(false)
  }
  const clearDateRange = () => {
    setOrderDateRange("last7")
    setOrderDate("")
    setOrderDateTo("")
  }
  const orderFilterDefinitions: Array<{ id: string; label: string }> = [
    { id: "status", label: "Order status" },
    { id: "source", label: "Channel" },
    { id: "payment", label: "Payment" },
    { id: "shipping", label: "Shipping status" },
    { id: "fulfillment", label: "Fulfillment" },
    { id: "delivery", label: "Delivery" },
    { id: "label", label: "Shipping label" },
    { id: "return", label: "Return status" },
    { id: "outcome", label: "Cancellation / refund" },
    { id: "exception", label: "Exceptions" },
    { id: "po", label: "Purchase order" },
    { id: "supplier", label: "Supplier" },
    { id: "brand", label: "Brand" },
    { id: "carrier", label: "Carrier" },
    { id: "country", label: "Destination country" },
    { id: "state", label: "Destination state" },
    { id: "warehouse", label: "Warehouse" },
    { id: "total", label: "Order total" },
  ]
  const activeOrderFilters = [
    status !== "all" && { label: "Status", value: selectedFilterLabels(status, statusFilterOptions), clear: () => setStatus("all") },
    source !== "all" && { label: "Channel", value: selectedFilterLabels(source, sourceFilterOptions), clear: () => setSource("all") },
    paymentFilter !== "all" && { label: "Payment", value: selectedFilterLabels(paymentFilter, paymentFilterOptions), clear: () => setPaymentFilter("all") },
    shippingFilter !== "all" && { label: "Shipping", value: selectedFilterLabels(shippingFilter, shippingFilterOptions), clear: () => setShippingFilter("all") },
    fulfillmentFilter !== "all" && { label: "Fulfillment", value: selectedFilterLabels(fulfillmentFilter, fulfillmentFilterOptions), clear: () => setFulfillmentFilter("all") },
    deliveryFilter !== "all" && { label: "Delivery", value: selectedFilterLabels(deliveryFilter, deliveryFilterOptions), clear: () => setDeliveryFilter("all") },
    labelFilter !== "all" && { label: "Label", value: selectedFilterLabels(labelFilter, labelFilterOptions), clear: () => setLabelFilter("all") },
    returnFilter !== "all" && { label: "Return", value: selectedFilterLabels(returnFilter, returnFilterOptions), clear: () => setReturnFilter("all") },
    outcomeFilter !== "all" && { label: "Outcome", value: selectedFilterLabels(outcomeFilter, outcomeFilterOptions), clear: () => setOutcomeFilter("all") },
    exceptionFilter !== "all" && { label: "Exceptions", value: selectedFilterLabels(exceptionFilter, exceptionFilterOptions), clear: () => setExceptionFilter("all") },
    poFilter !== "all" && { label: "PO", value: selectedFilterLabels(poFilter, poFilterOptions), clear: () => setPoFilter("all") },
    supplierFilter !== "all" && { label: "Supplier", value: supplierFilter, clear: () => setSupplierFilter("all") },
    brandFilter !== "all" && { label: "Brand", value: brandFilter, clear: () => setBrandFilter("all") },
    carrierFilter !== "all" && { label: "Carrier", value: carrierFilter, clear: () => setCarrierFilter("all") },
    countryFilter !== "all" && { label: "Country", value: countryFilter, clear: () => setCountryFilter("all") },
    stateFilter !== "all" && { label: "State", value: stateFilter, clear: () => setStateFilter("all") },
    warehouseFilter !== "all" && { label: "Warehouse", value: warehouseFilter, clear: () => setWarehouseFilter("all") },
    totalMinFilter && { label: "Minimum", value: moneyLabel(Number(totalMinFilter)), clear: () => setTotalMinFilter("") },
    totalMaxFilter && { label: "Maximum", value: moneyLabel(Number(totalMaxFilter)), clear: () => setTotalMaxFilter("") },
  ].filter(Boolean) as Array<{ label: string; value: string; clear: () => void }>
  const clearAllOrderFilters = () => {
    setStatus("all")
    setSource("all")
    setPaymentFilter("all")
    setShippingFilter("all")
    setFulfillmentFilter("all")
    setDeliveryFilter("all")
    setLabelFilter("all")
    setReturnFilter("all")
    setOutcomeFilter("all")
    setExceptionFilter("all")
    setPoFilter("all")
    setSupplierFilter("all")
    setBrandFilter("all")
    setCarrierFilter("all")
    setCountryFilter("all")
    setStateFilter("all")
    setWarehouseFilter("all")
    setTotalMinFilter("")
    setTotalMaxFilter("")
  }
  const applySharedOrderView = (view: Record<string, unknown>) => {
    const filters = (view.filters || {}) as Record<string, string>
    const range = (view.dateRange || {}) as Record<string, string>
    setQuery(String(filters.query || ""))
    setStatus(serializeOrderFilterValues(orderFilterValues(filters.status || "all"))); setSource(serializeOrderFilterValues(orderFilterValues(filters.source || "all"))); setPaymentFilter(serializeOrderFilterValues(orderFilterValues(filters.payment || "all"))); setShippingFilter(serializeOrderFilterValues(orderFilterValues(filters.shipping || "all"))); setFulfillmentFilter(serializeOrderFilterValues(orderFilterValues(filters.fulfillment || "all"))); setDeliveryFilter(serializeOrderFilterValues(orderFilterValues(filters.delivery || "all"))); setLabelFilter(serializeOrderFilterValues(orderFilterValues(filters.label || "all"))); setReturnFilter(serializeOrderFilterValues(orderFilterValues(filters.returnStatus || "all"))); setOutcomeFilter(serializeOrderFilterValues(orderFilterValues(filters.outcome || "all"))); setExceptionFilter(serializeOrderFilterValues(orderFilterValues(filters.exception || "all"))); setPoFilter(serializeOrderFilterValues(orderFilterValues(filters.po || "all"))); setSupplierFilter(String(filters.supplier || "all")); setBrandFilter(String(filters.brand || "all")); setCarrierFilter(String(filters.carrier || "all")); setCountryFilter(String(filters.country || "all")); setStateFilter(String(filters.state || "all")); setWarehouseFilter(String(filters.warehouse || "all")); setTotalMinFilter(String(filters.totalMin || "")); setTotalMaxFilter(String(filters.totalMax || ""))
    const rangeName = String(range.range || "last7"); const from = String(range.from || ""); const to = String(range.to || "")
    setOrderDateRange(rangeName); setOrderDate(from); setOrderDateTo(to); setAppliedOrderDateRange(rangeName); setAppliedOrderDate(from); setAppliedOrderDateTo(to)
    setSort(String(view.sort || "created-desc")); setVisibleAllColumns(new Set(Array.isArray(view.columns) && view.columns.length ? view.columns.map(String) : allOrderColumnOptions.map(([id]) => id)))
    setActiveOrderViewId(String(view.id || ""))
    toast.success(`Applied shared view: ${String(view.name || "Orders")}.`)
  }
  const saveSharedOrderView = async () => {
    const name = savedOrderViewName.trim()
    if (!name) { toast.error("Enter a name for the shared view."); return }
    try {
      const result = await api<{ view?: Record<string, unknown>; views?: Array<Record<string, unknown>> }>("/api/orders/views", { method: "POST", body: JSON.stringify({ name, filters: { query, status, source, payment: paymentFilter, shipping: shippingFilter, fulfillment: fulfillmentFilter, delivery: deliveryFilter, label: labelFilter, returnStatus: returnFilter, outcome: outcomeFilter, exception: exceptionFilter, po: poFilter, supplier: supplierFilter, brand: brandFilter, carrier: carrierFilter, country: countryFilter, state: stateFilter, warehouse: warehouseFilter, totalMin: totalMinFilter, totalMax: totalMaxFilter }, dateRange: { range: appliedOrderDateRange, from: appliedOrderDate, to: appliedOrderDateTo }, sort, columns: [...visibleAllColumns] }) })
      setSharedOrderViews(result.views || []); setActiveOrderViewId(String(result.view?.id || "")); setSavedOrderViewName(""); setSaveOrderViewOpen(false); toast.success(`Shared view ${name} saved and activated.`)
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save the shared view.") }
  }
  const removeSharedOrderView = async () => {
    if (!sharedOrderViews.length) return
    const name = window.prompt(`Remove which shared view?\n${sharedOrderViews.map((view) => String(view.name || "")).join("\n")}`)?.trim().toLowerCase()
    if (!name) return
    const view = sharedOrderViews.find((entry) => String(entry.name || "").toLowerCase() === name)
    if (!view) { toast.error("No shared view matched that name."); return }
    try { const result = await api<{ views?: Array<Record<string, unknown>> }>(`/api/orders/views/${encodeURIComponent(String(view.id || ""))}`, { method: "DELETE" }); setSharedOrderViews(result.views || []); if (activeOrderViewId === String(view.id || "")) setActiveOrderViewId(""); toast.success(`Shared view ${String(view.name)} removed.`) } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to remove the shared view.") }
  }
  const dateRangeMatches = (row: Record<string, unknown>) => {
    if (tab !== "orders") return true
    if (searchTerm.length >= 2) return true
    if (orderWorkspace === "open") return actionQueueIds.has(queueFor(row))
    const value = orderDateFor(row).slice(0, 10)
    if (!value) return false
    if (activeDateRange.from && value < activeDateRange.from) return false
    if (activeDateRange.to && value > activeDateRange.to) return false
    return true
  }
  const selectedStatuses = orderFilterValues(status)
  const selectedSources = orderFilterValues(source)
  const selectedPayments = orderFilterValues(paymentFilter)
  const selectedShippingStatuses = orderFilterValues(shippingFilter)
  const selectedFulfillmentStatuses = orderFilterValues(fulfillmentFilter)
  const selectedDeliveryStatuses = orderFilterValues(deliveryFilter)
  const selectedLabelStatuses = orderFilterValues(labelFilter)
  const selectedReturnStatuses = orderFilterValues(returnFilter)
  const selectedOutcomes = orderFilterValues(outcomeFilter)
  const selectedExceptionStates = orderFilterValues(exceptionFilter)
  const selectedPoStates = orderFilterValues(poFilter)
  const filtered = useMemo(() => rows
    .filter((row) => !searchTerm || matchesSearch(row, query, orderListSearchText(row)))
    .filter((row) => tab !== "orders" || (orderWorkspace === "open" ? actionQueueIds.has(queueFor(row)) && (queue === "all" || queueFor(row) === queue) : queue === "all" || queueFor(row) === queue))
    .filter((row) => selectedStatuses.length === 0 || selectedStatuses.includes(normalizeOrderFilterValue(row.status || row.returnStatus)))
    .filter((row) => selectedSources.length === 0 || selectedSources.includes(normalizeOrderFilterValue(orderChannelFilterValue(row))))
    .filter((row) => orderWorkspace !== "all" || selectedPayments.length === 0 || selectedPayments.includes(normalizeOrderFilterValue(row.financialStatus || row.paymentStatus || "unpaid").replace(/\s+/g, "_")))
    .filter((row) => orderWorkspace !== "all" || selectedShippingStatuses.length === 0 || selectedShippingStatuses.includes(shippingStateFor(row)))
    .filter((row) => orderWorkspace !== "all" || selectedFulfillmentStatuses.length === 0 || selectedFulfillmentStatuses.some((filterValue) => normalizeOrderFilterValue(row.fulfillmentStatus || row.fulfillmentStage || row.status).includes(filterValue)))
    .filter((row) => orderWorkspace !== "all" || selectedDeliveryStatuses.length === 0 || selectedDeliveryStatuses.some((filterValue) => deliveryStateFor(row).replace(/\s+/g, "_").includes(filterValue)))
    .filter((row) => orderWorkspace !== "all" || selectedLabelStatuses.length === 0 || selectedLabelStatuses.includes(labelStateFor(row)))
    .filter((row) => orderWorkspace !== "all" || selectedReturnStatuses.length === 0 || selectedReturnStatuses.some((filterValue) => filterValue === "has_return" ? Boolean(row.returnId || row.returnNumber || row.returnRequestedAt || (Array.isArray(row.returns) && row.returns.length)) : filterValue === "no_return" ? !row.returnId && !row.returnNumber && !row.returnRequestedAt && !(Array.isArray(row.returns) && row.returns.length) : filterValue === "received" ? Boolean(row.returnReceivedAt) : Boolean(row.returnRequestedAt || row.returnId || row.returnNumber) && !row.returnReceivedAt))
    .filter((row) => orderWorkspace !== "all" || selectedOutcomes.length === 0 || selectedOutcomes.some((filterValue) => filterValue === "canceled" ? ["canceled", "cancelled", "void", "voided"].includes(String(row.status || "").toLowerCase()) || Boolean(row.cancelledAt || row.canceledAt) : filterValue === "refunded" ? String(row.status || "").toLowerCase().includes("refund") || Boolean(row.refundedAt) || Number(row.refundAmount || 0) > 0 : !["canceled", "cancelled", "void", "voided", "refunded", "refund"].includes(String(row.status || "").toLowerCase()) && !row.cancelledAt && !row.canceledAt))
    .filter((row) => orderWorkspace !== "all" || selectedExceptionStates.length === 0 || selectedExceptionStates.some((filterValue) => filterValue === "has_exception" ? Array.isArray(row.workflowExceptions) && row.workflowExceptions.length > 0 : !Array.isArray(row.workflowExceptions) || row.workflowExceptions.length === 0))
    .filter((row) => orderWorkspace !== "all" || selectedPoStates.length === 0 || selectedPoStates.some((filterValue) => filterValue === "linked" ? orderHasPo(row) : !orderHasPo(row)))
    .filter((row) => orderWorkspace !== "all" || supplierFilter === "all" || [supplierFor(row), ...(Array.isArray(row.items) ? (row.items as Array<Record<string, unknown>>).map((item) => String(item.supplier || item.vendor || item.vendorName || "")) : [])].some((value) => value.toLowerCase() === supplierFilter.toLowerCase()))
    .filter((row) => orderWorkspace !== "all" || brandFilter === "all" || [brandFor(row), ...(Array.isArray(row.items) ? (row.items as Array<Record<string, unknown>>).map((item) => String(item.brand || item.brandName || "")) : [])].some((value) => value.toLowerCase() === brandFilter.toLowerCase()))
    .filter((row) => orderWorkspace !== "all" || carrierFilter === "all" || carrierFor(row) === carrierFilter)
    .filter((row) => orderWorkspace !== "all" || countryFilter === "all" || countryFor(row) === countryFilter)
    .filter((row) => orderWorkspace !== "all" || stateFilter === "all" || stateFor(row).toLowerCase() === stateFilter.toLowerCase())
    .filter((row) => orderWorkspace !== "all" || warehouseFilter === "all" || warehouseFor(row).toLowerCase() === warehouseFilter.toLowerCase())
    .filter((row) => orderWorkspace !== "all" || !totalMinFilter || Number(row.total || 0) >= Number(totalMinFilter))
    .filter((row) => orderWorkspace !== "all" || !totalMaxFilter || Number(row.total || 0) <= Number(totalMaxFilter))
    .filter(dateRangeMatches)
    .sort((left, right) => {
      const leftValue = sort.startsWith("total") ? Number(left.total || left.refundAmount || 0) : sort.startsWith("customer") ? String(left.buyer || left.customerName || "") : new Date(orderDateFor(left) || 0).getTime()
      const rightValue = sort.startsWith("total") ? Number(right.total || right.refundAmount || 0) : sort.startsWith("customer") ? String(right.buyer || right.customerName || "") : new Date(orderDateFor(right) || 0).getTime()
      const result = typeof leftValue === "number" && typeof rightValue === "number" ? leftValue - rightValue : String(leftValue).localeCompare(String(rightValue))
      return sort.endsWith("asc") ? result : -result
    }), [rows, searchTerm, tab, queue, status, source, activeDateRange.from, activeDateRange.to, sort, orderWorkspace, paymentFilter, shippingFilter, fulfillmentFilter, deliveryFilter, labelFilter, returnFilter, outcomeFilter, exceptionFilter, poFilter, supplierFilter, brandFilter, carrierFilter, countryFilter, stateFilter, warehouseFilter, totalMinFilter, totalMaxFilter])
  const pageSize = 100
  const filteredTotal = orderWorkspace === "all" ? Number(data.total ?? filtered.length) : filtered.length
  const pageCount = orderWorkspace === "all" ? Math.max(1, Number(data.totalPages || Math.ceil(filteredTotal / pageSize))) : Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const visibleRows = orderWorkspace === "all" ? filtered : filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const selectedVisible = visibleRows.filter((row) => selectedIds.has(String(row.id || "")))
  const current: Record<string, unknown> = detail || selected || {}
  const currentShipments = Array.isArray(current.shipments) ? current.shipments as Array<Record<string, unknown>> : []
  const currentPayments = Array.isArray(current.payments) ? current.payments as Array<Record<string, unknown>> : []

  return <div className="grid gap-5">
    <PageHeader
      eyebrow="Operations"
      title={tab === "orders" ? orderWorkspace === "open" ? "Open Orders" : "All Orders" : tab === "drafts" ? "Drafts & Quotes" : "Returns"}
      description={tab === "drafts" ? "Build a priced customer proposal, revise it freely, then convert the accepted quote into an operational order." : tab === "returns" ? "Track the return from request through receiving, inspection, disposition, and any required refund." : orderWorkspace === "open" ? "A live work queue for paid orders that still need a decision, purchasing, or fulfillment action." : "Search, filter, save live views, and export every matching order. This view defaults to the last seven days."}
      action={<div className="flex flex-wrap gap-2">
        {tab === "orders" && orderWorkspace === "all" && <Button size="sm" variant="outline" disabled={loading || filteredTotal === 0} onClick={() => { setOrderExportScope(selectedIds.size ? "selected" : "filtered"); setOrderExportOpen(true) }}><FileDown className="size-4" /> Export</Button>}
        {tab === "orders" && <Button size="sm" variant="outline" disabled={busy || loading || !hasOrderChannel} title={!hasOrderChannel ? "No Shopify channel is connected to this company" : undefined} onClick={() => void importShopifyOrders()}><Store className="size-4" /> Import Shopify orders</Button>}
        {tab === "orders" && <Button size="sm" variant="outline" disabled={busy || loading || !historicalBackfillChannels.length} onClick={() => { setHistoricalBackfillConfirmed(false); setHistoricalBackfillOpen(true) }}><History className="size-4" /> Historical import</Button>}
        {tab === "orders" && <Button size="sm" variant="outline" disabled={busy || loading} onClick={() => void openInternalNumberResequence()}><ArrowUpDown className="size-4" /> Resequence IDs</Button>}
        {tab === "drafts" && <Button size="sm" disabled={busy} onClick={() => void createQuote()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />} Create quote</Button>}
        {tab === "returns" && <Button size="sm" disabled={busy || !warehouses.length} onClick={() => { setReturnOrderSearch(""); setReturnOrderResults([]); setReturnOrderDetail(null); setReturnForm((current) => ({ ...current, orderId: "", warehouseId: String(warehouses[0]?.id || "") })); setReturnOpen(true) }}><RotateCcw className="size-4" /> Create return</Button>}
        <Button size="sm" variant="outline" disabled={tab !== "returns" && loading} onClick={() => { if (tab === "returns") setReturnsRefreshKey((current) => current + 1); else void load() }}>{tab !== "returns" && loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button>
      </div>}
    />
    <div className="flex flex-wrap gap-1 rounded-md border bg-card p-1">
      <Button size="sm" variant={tab === "orders" && orderWorkspace === "open" ? "secondary" : "ghost"} asChild><a href="/orders">Open Orders <Badge variant="outline" className="ml-1.5">{numberLabel(actionRequiredCount)}</Badge></a></Button>
      <Button size="sm" variant={tab === "orders" && orderWorkspace === "all" ? "secondary" : "ghost"} asChild><a href="/orders/all">All Orders <Badge variant="outline" className="ml-1.5">{numberLabel(Number(orderMetrics.ytdCount || 0))}</Badge></a></Button>
      <Button size="sm" variant={tab === "drafts" ? "secondary" : "ghost"} asChild><a href="/drafts">Drafts <Badge variant="outline" className="ml-1.5">{numberLabel(data.orderDrafts?.length)}</Badge></a></Button>
      <Button size="sm" variant={tab === "returns" ? "secondary" : "ghost"} asChild><a href="/returns">Returns <Badge variant="outline" className="ml-1.5">{numberLabel(returnTotal)}</Badge></a></Button>
    </div>
    {tab === "orders" && <a className="text-sm text-primary underline" href="/orders/data-review">Data Review</a>}
    {tab === "orders" && <ImportDashboard compact />}
    {tab === "returns" && <ReturnsWorkspace warehouses={warehouses} busy={busy} refreshKey={returnsRefreshKey} onUpdated={load} onTotalChange={setReturnTotal} onSync={importChannelReturns} onTransactions={setTransactionReturn} />}
    {tab === "orders" && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label={orderWorkspace === "open" ? "Action required" : "Orders (7 days)"} value={numberLabel(orderWorkspace === "open" ? actionRequiredCount : Number(orderMetrics.last7DaysCount || 0))} icon={orderWorkspace === "open" ? AlertTriangle : ShoppingBag} />
      <MetricCard label={orderWorkspace === "open" ? "Ready to ship" : "Matching orders"} value={numberLabel(orderWorkspace === "open" ? counts["ready-ship"] : filteredTotal)} icon={Truck} />
      <MetricCard label={orderWorkspace === "open" ? "Waiting for PO" : "YTD orders"} value={numberLabel(orderWorkspace === "open" ? counts["waiting-po"] : Number(orderMetrics.ytdCount || 0))} icon={Archive} />
      <MetricCard label={orderWorkspace === "open" ? "Needs attention" : "Rows on this page"} value={numberLabel(orderWorkspace === "open" ? counts.exceptions + counts.review : orderRows.length)} icon={orderWorkspace === "open" ? AlertCircle : ListChecks} />
    </div>}
    {tab === "orders" && orderWorkspace === "open" && <div className="flex gap-1 overflow-x-auto rounded-md border bg-card p-1">{visibleQueueDefinitions.map(([id, label, description]) => <Button key={id} size="sm" variant={queue === id ? "secondary" : "ghost"} className="shrink-0" title={description} onClick={() => setQueue(id)}>{id === "all" ? "All open" : label}<Badge variant="outline" className="ml-1.5">{numberLabel(id === "all" ? actionRequiredCount : counts[id])}</Badge></Button>)}</div>}
    {tab !== "returns" && <Card>
      <CardHeader className="gap-3 border-b">
        {tab === "orders" && orderWorkspace === "all" ? <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="w-[360px] max-w-[78vw] pl-9" value={query} onChange={(event) => setQuery(event.target.value)} onPaste={(event) => normalizePastedSearch(event, query, setQuery)} placeholder="Search or paste orders, SKUs, tracking..." /></div><BulkSearchActions onApply={setQuery} />
            <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline">Views</Button></DropdownMenuTrigger><DropdownMenuContent align="start" className="min-w-60"><DropdownMenuLabel>Shared order views</DropdownMenuLabel>{sharedOrderViews.length ? sharedOrderViews.map((view) => <DropdownMenuItem key={String(view.id || view.name)} onSelect={() => applySharedOrderView(view)}>{String(view.name || "Untitled view")}</DropdownMenuItem>) : <DropdownMenuItem disabled>No shared views yet</DropdownMenuItem>}<DropdownMenuSeparator /><DropdownMenuItem onSelect={() => { setSavedOrderViewName(""); setSaveOrderViewOpen(true) }}>Save current view...</DropdownMenuItem>{sharedOrderViews.length > 0 && <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void removeSharedOrderView()}>Remove shared view...</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>
            <Popover open={dateRangeOpen} onOpenChange={setDateRangeOpen}><PopoverTrigger asChild><Button size="sm" variant="outline" className="font-normal"><CalendarDays className="size-4" /> {activeDateRange.label}</Button></PopoverTrigger><PopoverContent align="start" className="w-[min(44rem,calc(100vw-2rem))] p-3"><div className="grid gap-3"><div><p className="text-sm font-semibold">Order date range</p><p className="text-xs text-muted-foreground">Choose a preset or any From and To dates, then apply the range.</p></div><div className="flex flex-wrap gap-2">{orderDateRangeOptions.filter((option) => !["exact", "custom"].includes(option.value)).map((option) => <Button key={option.value} size="sm" variant={orderDateRange === option.value ? "secondary" : "outline"} onClick={() => setDatePreset(option.value)}>{option.label}</Button>)}</div><div className="grid gap-3 sm:grid-cols-2"><Field label="From"><Input type="date" value={orderDate} onChange={(event) => { setOrderDateRange("custom"); setOrderDate(event.target.value) }} /></Field><Field label="To"><Input type="date" value={orderDateTo} onChange={(event) => { setOrderDateRange("custom"); setOrderDateTo(event.target.value) }} /></Field></div><div className="overflow-x-auto rounded-md border"><Calendar mode="range" numberOfMonths={2} selected={{ from: orderDate ? new Date(`${orderDate}T12:00:00`) : undefined, to: orderDateTo ? new Date(`${orderDateTo}T12:00:00`) : undefined }} onSelect={(range) => { setOrderDateRange("custom"); setOrderDate(range?.from ? localDateKey(range.from) : ""); setOrderDateTo(range?.to ? localDateKey(range.to) : "") }} /></div><div className="flex items-center justify-between border-t pt-3"><Button size="sm" variant="ghost" onClick={clearDateRange}>Clear</Button><Button size="sm" onClick={applyDateRange}>Apply</Button></div></div></PopoverContent></Popover>
            <Select value={sort} onValueChange={setSort}><SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="created-desc">Newest order date</SelectItem><SelectItem value="created-asc">Oldest order date</SelectItem><SelectItem value="total-desc">Highest total</SelectItem><SelectItem value="total-asc">Lowest total</SelectItem><SelectItem value="customer-asc">Customer A-Z</SelectItem></SelectContent></Select>
            <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="outline"><ListChecks className="size-4" /> Columns</Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-56"><DropdownMenuLabel>Visible columns</DropdownMenuLabel><DropdownMenuSeparator />{allOrderColumnOptions.map(([id, label]) => <DropdownMenuCheckboxItem key={id} checked={visibleAllColumns.has(id)} onCheckedChange={(checked) => setVisibleAllColumns((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next })}>{label}</DropdownMenuCheckboxItem>)}<DropdownMenuSeparator /><DropdownMenuItem onSelect={() => setVisibleAllColumns(new Set(allOrderColumnOptions.map(([id]) => id)))}>Reset columns</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[repeat(4,minmax(150px,1fr))_auto]">
            <OrderMultiSelect value={status} onValueChange={setStatus} options={statusFilterOptions} placeholder="All order statuses" searchPlaceholder="Search order statuses" />
            <OrderMultiSelect value={source} onValueChange={setSource} options={sourceFilterOptions} placeholder="All channels" searchPlaceholder="Search channels" />
            <OrderMultiSelect value={paymentFilter} onValueChange={setPaymentFilter} options={paymentFilterOptions} placeholder="Any payment status" searchPlaceholder="Search payment statuses" />
            <OrderMultiSelect value={shippingFilter} onValueChange={setShippingFilter} options={shippingFilterOptions} placeholder="Any shipping status" searchPlaceholder="Search shipping statuses" />
            <Popover open={orderAdvancedFilterOpen} onOpenChange={setOrderAdvancedFilterOpen}><PopoverTrigger asChild><Button size="sm" variant="outline"><SlidersHorizontal className="size-4" /> More filters</Button></PopoverTrigger><PopoverContent align="end" className="w-[min(26rem,calc(100vw-2rem))]"><div className="grid gap-3"><div><p className="text-sm font-semibold">More order filters</p><p className="text-xs text-muted-foreground">Combine filters to narrow the live result set.</p></div><Select value={orderAdvancedFilterField} onValueChange={setOrderAdvancedFilterField}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{orderFilterDefinitions.filter((definition) => !["status", "source", "payment", "shipping"].includes(definition.id)).map((definition) => <SelectItem key={definition.id} value={definition.id}>{definition.label}</SelectItem>)}</SelectContent></Select>
              {orderAdvancedFilterField === "fulfillment" && <OrderMultiSelect value={fulfillmentFilter} onValueChange={setFulfillmentFilter} options={fulfillmentFilterOptions} placeholder="Any fulfillment status" />}
              {orderAdvancedFilterField === "delivery" && <OrderMultiSelect value={deliveryFilter} onValueChange={setDeliveryFilter} options={deliveryFilterOptions} placeholder="Any delivery status" />}
              {orderAdvancedFilterField === "label" && <OrderMultiSelect value={labelFilter} onValueChange={setLabelFilter} options={labelFilterOptions} placeholder="Any label status" />}
              {orderAdvancedFilterField === "return" && <OrderMultiSelect value={returnFilter} onValueChange={setReturnFilter} options={returnFilterOptions} placeholder="Any return status" />}
              {orderAdvancedFilterField === "outcome" && <OrderMultiSelect value={outcomeFilter} onValueChange={setOutcomeFilter} options={outcomeFilterOptions} placeholder="Any outcome" />}
              {orderAdvancedFilterField === "exception" && <OrderMultiSelect value={exceptionFilter} onValueChange={setExceptionFilter} options={exceptionFilterOptions} placeholder="Any exception state" />}
              {orderAdvancedFilterField === "po" && <OrderMultiSelect value={poFilter} onValueChange={setPoFilter} options={poFilterOptions} placeholder="Any PO state" />}
              {orderAdvancedFilterField === "supplier" && <Input value={supplierFilter === "all" ? "" : supplierFilter} onChange={(event) => setSupplierFilter(event.target.value || "all")} list="all-orders-suppliers" placeholder="Exact supplier name" />}
              {orderAdvancedFilterField === "brand" && <Input value={brandFilter === "all" ? "" : brandFilter} onChange={(event) => setBrandFilter(event.target.value || "all")} list="all-orders-brands" placeholder="Exact brand name" />}
              {orderAdvancedFilterField === "carrier" && <Input value={carrierFilter === "all" ? "" : carrierFilter} onChange={(event) => setCarrierFilter(event.target.value || "all")} list="all-orders-carriers" placeholder="Exact carrier name" />}
              {orderAdvancedFilterField === "country" && <Input value={countryFilter === "all" ? "" : countryFilter} onChange={(event) => setCountryFilter(event.target.value || "all")} list="all-orders-countries" placeholder="Country code or name" />}
              {orderAdvancedFilterField === "state" && <Input value={stateFilter === "all" ? "" : stateFilter} onChange={(event) => setStateFilter(event.target.value || "all")} list="all-orders-states" placeholder="State or province" />}
              {orderAdvancedFilterField === "warehouse" && <Input value={warehouseFilter === "all" ? "" : warehouseFilter} onChange={(event) => setWarehouseFilter(event.target.value || "all")} list="all-orders-warehouses" placeholder="Warehouse name or ID" />}
              {orderAdvancedFilterField === "total" && <div className="grid grid-cols-2 gap-2"><Input type="number" min="0" step="0.01" value={totalMinFilter} onChange={(event) => setTotalMinFilter(event.target.value)} placeholder="Minimum" /><Input type="number" min="0" step="0.01" value={totalMaxFilter} onChange={(event) => setTotalMaxFilter(event.target.value)} placeholder="Maximum" /></div>}
              <div className="flex justify-end"><Button size="sm" onClick={() => setOrderAdvancedFilterOpen(false)}>Done</Button></div>
            </div></PopoverContent></Popover>
          </div>
          <datalist id="all-orders-suppliers">{supplierValues.map((value) => <option key={value} value={value} />)}</datalist><datalist id="all-orders-brands">{brandValues.map((value) => <option key={value} value={value} />)}</datalist><datalist id="all-orders-carriers">{carrierValues.map((value) => <option key={value} value={value} />)}</datalist><datalist id="all-orders-countries">{countryValues.map((value) => <option key={value} value={value} />)}</datalist><datalist id="all-orders-states">{stateValues.map((value) => <option key={value} value={value} />)}</datalist><datalist id="all-orders-warehouses">{warehouseValues.map((value) => <option key={value} value={value} />)}</datalist>
          {activeOrderViewId && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Badge variant="secondary">Active view</Badge><span>{String(sharedOrderViews.find((view) => String(view.id || "") === activeOrderViewId)?.name || "Saved order view")}</span></div>}
          {activeOrderFilters.length > 0 && <div className="flex flex-wrap items-center gap-2">{activeOrderFilters.map((filter) => <Button key={filter.label} size="sm" variant="secondary" className="h-7 gap-1 px-2 text-xs" onClick={filter.clear}>{filter.label}: {filter.value}<X className="size-3" /></Button>)}<Button size="sm" variant="ghost" className="h-7" onClick={clearAllOrderFilters}>Clear filters</Button></div>}
        </div> : <div className="grid gap-2 xl:grid-cols-[minmax(300px,1fr)_170px_170px_170px]">
          <div className="flex min-w-0 flex-wrap gap-2"><div className="relative min-w-64 flex-1"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={(event) => setQuery(event.target.value)} onPaste={(event) => normalizePastedSearch(event, query, setQuery)} placeholder="Search or paste orders, SKUs, tracking..." /></div><BulkSearchActions onApply={setQuery} /></div>
          <OrderMultiSelect value={status} onValueChange={setStatus} options={statusFilterOptions} placeholder="All statuses" searchPlaceholder="Search statuses" />
          <OrderMultiSelect value={source} onValueChange={setSource} options={sourceFilterOptions} placeholder="All channels" searchPlaceholder="Search channels" />
          <Select value={sort} onValueChange={setSort}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="created-desc">Newest order date</SelectItem><SelectItem value="created-asc">Oldest order date</SelectItem><SelectItem value="total-desc">Highest total</SelectItem><SelectItem value="total-asc">Lowest total</SelectItem><SelectItem value="customer-asc">Customer A-Z</SelectItem></SelectContent></Select>
        </div>}
        <CardDescription>{tab === "orders" && searchTerms.length > 1 ? `Showing exact matches for ${numberLabel(searchTerms.length)} pasted identifiers. ` : tab === "orders" && searchTerm.length >= 2 ? "Search checks all orders by internal order, channel order number, customer, address, SKU, and tracking. " : tab === "orders" && orderWorkspace === "all" ? `Showing ${activeDateRange.label}. ` : tab === "orders" ? "Showing all actionable work regardless of age. " : ""}{numberLabel(visibleRows.length)} of {numberLabel(filteredTotal)} filtered records shown, page {numberLabel(currentPage)} of {numberLabel(pageCount)}.</CardDescription>
      </CardHeader>
      {selectedVisible.length > 0 && <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-2"><span className="text-sm font-medium">{selectedVisible.length} selected</span><Button size="sm" disabled={busy} onClick={() => void createSupplierPos(selectedVisible.map((row) => String(row.id)))}>Create supplier POs</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void runAction(selectedVisible.map((row) => String(row.id)), "approve")}>Approve</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void runAction(selectedVisible.map((row) => String(row.id)), "hold")}>Put on hold</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void runAction(selectedVisible.map((row) => String(row.id)), "done")}>Mark done</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setSelectedIds(new Set())}>Clear</Button></div>}
      <CardContent className="p-0">
        {tab === "drafts" && loading && <div className="grid gap-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>}
        {tab === "drafts" && !loading && <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Quote</TableHead><TableHead>Customer</TableHead><TableHead>Ship to</TableHead><TableHead>Items</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead>Source</TableHead><TableHead>Updated</TableHead><TableHead /></TableRow></TableHeader><TableBody>{filtered.map((draft, index) => { const id = String(draft.id || ""); const address = (draft.shippingAddress || {}) as Record<string, unknown>; const shipTo = [address.city, address.state || address.province, address.postalCode || address.zip].filter(Boolean).join(", ") || "No address"; const items = Array.isArray(draft.items) ? draft.items as Array<Record<string, unknown>> : []; const total = items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.qty || 0), 0); return <TableRow key={`${id}-${index}`}><TableCell><a href={`/drafts/${encodeURIComponent(id || String(draft.draftNumber || ""))}`} className="font-medium hover:underline">{String(draft.draftNumber || id)}</a></TableCell><TableCell><div>{String(draft.buyer || "-")}</div><p className="text-xs text-muted-foreground">{String(draft.buyerEmail || "")}</p></TableCell><TableCell>{shipTo}</TableCell><TableCell>{numberLabel(items.reduce((sum, item) => sum + Number(item.qty || 0), 0))}</TableCell><TableCell className="font-medium">{moneyLabel(total)}</TableCell><TableCell><Badge variant="outline">{String(draft.status || "draft")}</Badge></TableCell><TableCell>{String(draft.source || "Manual")}</TableCell><TableCell>{dateLabel(String(draft.updatedAt || draft.createdAt || ""))}</TableCell><TableCell><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" title="Quote actions"><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem asChild><a href={`/drafts/${encodeURIComponent(id || String(draft.draftNumber || ""))}`}>Open quote</a></DropdownMenuItem><DropdownMenuItem onSelect={() => void duplicateDraft(draft)}>Duplicate quote</DropdownMenuItem><DropdownMenuItem onSelect={() => void convertDraft(draft)}>Convert to order</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem asChild><a href={`/api/order-drafts/${encodeURIComponent(id)}/export/pdf`} target="_blank" rel="noreferrer">Download quote</a></DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell></TableRow> })}{!filtered.length && <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted-foreground">No draft quotes match the current filters.</TableCell></TableRow>}</TableBody></Table></div>}
        {tab !== "drafts" && <>
        {loading ? <div className="grid gap-2 p-4"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="w-10"><Checkbox aria-label="Select visible records" checked={visibleRows.length > 0 && selectedVisible.length === visibleRows.length} onCheckedChange={(checked) => setSelectedIds(checked === true ? new Set(visibleRows.map((row) => String(row.id || ""))) : new Set())} /></TableHead><TableHead>{tab === "orders" ? "Order" : "Return"}</TableHead>{showAllColumn("date") && <TableHead>{tab === "orders" ? "Order date" : "Updated"}</TableHead>}{showAllColumn("customer") && <TableHead>Customer</TableHead>}{showAllColumn("fulfillBy") && <TableHead>{tab === "orders" ? "Fulfill by" : "Warehouse"}</TableHead>}{showAllColumn("channel") && <TableHead>{tab === "orders" ? "Channel" : "Reason"}</TableHead>}{showAllColumn("total") && <TableHead>{tab === "orders" ? "Revenue" : "Amount"}</TableHead>}{showAllColumn("shipping") && <TableHead>Customer shipping</TableHead>}{showAllColumn("labelCost") && <TableHead>Label cost</TableHead>}{showAllColumn("profit") && <TableHead>Est. profit</TableHead>}{showAllColumn("payment") && <TableHead>{tab === "orders" ? "Payment status" : "Status"}</TableHead>}{showAllColumn("fulfillment") && <TableHead>{tab === "orders" ? (orderWorkspace === "all" ? "Fulfillment status" : "Supply") : "Disposition"}</TableHead>}{showAllColumn("items") && <TableHead>{tab === "orders" ? (orderWorkspace === "all" ? "Items" : "PO") : "Channel sync"}</TableHead>}{showAllColumn("supplier") && <TableHead>Supplier</TableHead>}{showAllColumn("po") && <TableHead>Purchase order</TableHead>}{showAllColumn("carrier") && <TableHead>Carrier</TableHead>}{showAllColumn("tracking") && <TableHead>Tracking</TableHead>}{showAllColumn("delivery") && <TableHead>{tab === "orders" ? (orderWorkspace === "all" ? "Delivery status" : "Channel") : "Channel"}</TableHead>}{showAllColumn("destination") && <TableHead>Ship to</TableHead>}{showAllColumn("updated") && <TableHead>Last updated</TableHead>}<TableHead /></TableRow></TableHeader><TableBody>{visibleRows.map((row, index) => {
          const reference = String(tab === "orders" ? row.orderNumber || row.id || "-" : row.returnNumber || row.reference || row.id || "-")
          const items = Array.isArray(row.items) ? row.items as Array<Record<string, unknown>> : []
          const itemCount = items.reduce((total, item) => total + Number(item.qty || 0), 0) || Number(row.qty || 0)
          const id = String(row.id || "")
          const orderQueue = tab === "orders" ? queueFor(row) : String(row.status || row.returnStatus || "draft")
          const hasPo = (Array.isArray(row.purchaseOrderIds) && row.purchaseOrderIds.length > 0) || (Array.isArray(row.purchaseOrderNumbers) && row.purchaseOrderNumbers.length > 0) || (Array.isArray(row.fulfillmentRoutes) && (row.fulfillmentRoutes as Array<Record<string, unknown>>).some((route) => Boolean(route.purchaseOrderId)))
          const linkedOrderId = String(row.orderId || "")
          const paymentStatus = String(row.financialStatus || row.paymentStatus || "Unpaid")
          const paymentPaid = paymentStatus.toLowerCase() === "paid"
          const rawFulfillmentStatus = String(row.fulfillmentStatus || row.fulfillmentStage || row.status || orderQueue)
          const fulfillmentStatus = normalizeOrderFilterValue(rawFulfillmentStatus) === "canceled" ? "Canceled" : rawFulfillmentStatus.replace(/_/g, " ")
          const deliveryStatus = String(row.deliveryStatus || row.trackingStatus || (Array.isArray(row.shipments) && row.shipments[0] ? (row.shipments[0] as Record<string, unknown>).status || "" : "") || "No tracking").replace(/_/g, " ")
          const shipment = shipmentFor(row)
          const shipmentCount = Array.isArray(row.shipments)
            ? (row.shipments as Array<Record<string, unknown>>).filter((entry) => !["canceled", "cancelled", "void", "voided", "unshipped", "superseded"].includes(String(entry.status || "").toLowerCase())).length
            : 0
          const hasMultipleShipments = tab === "orders" && shipmentCount > 1
          const customerShipping = Number(row.customerShipping || row.shipping || row.shippingTotal || 0)
          const labelCost = Number(row.labelCost || row.shippingCost || shipment.labelCost || shipment.cost || shipment.shippingCost || 0)
          const itemCost = items.reduce((total, item) => total + Number(item.cost || item.unitCost || 0) * Number(item.qty || 0), 0)
          const estimatedProfit = Number(row.profit ?? row.estimatedProfit ?? (Number(row.total || 0) - itemCost - labelCost))
          const tracking = String(shipment.trackingNumber || shipment.tracking || row.trackingNumber || "")
          return <TableRow key={`${reference}-${index}`} data-state={selectedIds.has(id) ? "selected" : undefined}>
            <TableCell><Checkbox aria-label={`Select ${reference}`} checked={selectedIds.has(id)} onCheckedChange={(checked) => setSelectedIds((current) => { const next = new Set(current); if (checked === true) next.add(id); else next.delete(id); return next })} /></TableCell>
            <TableCell className="min-w-44"><div className="group flex items-center gap-1">{tab === "orders" ? <><a href={`/orders/${encodeURIComponent(id || reference)}`} className="font-medium hover:underline">{reference}</a>{isEbayLiveOrder(row) && <EbayLiveMark />}{isTikTokLiveOrder(row) && <TikTokLiveMark />}{hasMultipleShipments && <Tooltip><TooltipTrigger asChild><span className="inline-flex items-center gap-0.5 text-muted-foreground"><Boxes className="size-3.5" /><span className="text-xs font-medium">{shipmentCount}</span></span></TooltipTrigger><TooltipContent>{shipmentCount} shipment packages recorded for this order.</TooltipContent></Tooltip>}<OrderListPreview order={row} orderId={id} reference={reference} itemCount={itemCount} hasPo={hasPo} queue={orderQueue} /></> : <a href={rmaHref(row)} className="font-medium hover:underline">{reference}</a>}</div>{tab !== "orders" && <p className="text-xs text-muted-foreground">Order {String(row.orderNumber || linkedOrderId || "Unlinked")}</p>}</TableCell>
            {showAllColumn("date") && <TableCell>{dateLabel(tab === "orders" ? orderDateFor(row) : String(row.updatedAt || row.createdAt || ""))}</TableCell>}
            {showAllColumn("customer") && <TableCell className="min-w-40">{String(row.buyer || row.customerName || row.customerEmail || "-")}</TableCell>}
            {showAllColumn("fulfillBy") && <TableCell>{tab === "orders" ? String(row.shipBy || "Not scheduled") : String(row.warehouseName || "-")}</TableCell>}
            {showAllColumn("channel") && <TableCell>{tab === "orders" ? orderWorkspace === "all" ? <span className="inline-flex items-center gap-1.5"><span>{String(row.channelSource || row.salesChannel || row.source || "-")}</span>{isEbayLiveOrder(row) && <EbayLiveMark />}{isTikTokLiveOrder(row) && <TikTokLiveMark />}</span> : numberLabel(itemCount) : String(row.reason || "-")}</TableCell>}
            {showAllColumn("total") && <TableCell className="font-medium">{moneyLabel(Number(row.total || row.amount || row.refundAmount || 0))}</TableCell>}
            {showAllColumn("shipping") && <TableCell>{moneyLabel(customerShipping)}</TableCell>}
            {showAllColumn("labelCost") && <TableCell>{labelCost ? moneyLabel(labelCost) : "-"}</TableCell>}
            {showAllColumn("profit") && <TableCell className={estimatedProfit < 0 ? "text-destructive" : ""}>{moneyLabel(estimatedProfit)}</TableCell>}
            {showAllColumn("payment") && <TableCell>{tab === "orders" ? <Badge variant={paymentPaid ? "secondary" : "outline"}>{paymentStatus}</Badge> : <Badge variant="outline">{String(row.status || row.returnStatus || "Pending")}</Badge>}</TableCell>}
            {showAllColumn("fulfillment") && <TableCell>{tab === "orders" ? orderWorkspace === "all" ? <Badge variant={fulfillmentStatus.toLowerCase().includes("fulfill") || fulfillmentStatus.toLowerCase().includes("ship") ? "secondary" : "outline"}>{fulfillmentStatus}</Badge> : <Badge variant={orderQueue === "review" || orderQueue === "not-routed" ? "destructive" : orderQueue === "ready-ship" ? "secondary" : "outline"}>{orderQueue.replace(/-/g, " ")}</Badge> : String(row.disposition || "Pending")}</TableCell>}
            {showAllColumn("items") && <TableCell>{tab === "orders" ? orderWorkspace === "all" ? numberLabel(itemCount) : <span className={`inline-flex items-center gap-1 text-xs font-medium ${hasPo ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`} title={hasPo ? `Purchase order: ${Array.isArray(row.purchaseOrderNumbers) ? row.purchaseOrderNumbers.join(", ") : "linked"}` : "No purchase order linked"}>{hasPo ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}{hasPo ? "Linked" : "None"}</span> : <Badge variant="outline">{String(row.channelStatus || (row.channelSync as Record<string, unknown> | undefined)?.status || "Local")}</Badge>}</TableCell>}
            {showAllColumn("supplier") && <TableCell>{supplierFor(row) || "-"}</TableCell>}
            {showAllColumn("po") && <TableCell>{Array.isArray(row.purchaseOrderNumbers) && row.purchaseOrderNumbers.length ? row.purchaseOrderNumbers.join(", ") : "-"}</TableCell>}
            {showAllColumn("carrier") && <TableCell>{carrierFor(row) || "-"}</TableCell>}
            {showAllColumn("tracking") && <TableCell className="font-mono text-xs">{tracking || "-"}</TableCell>}
            {showAllColumn("delivery") && <TableCell>{tab === "orders" ? orderWorkspace === "all" ? <Badge variant={deliveryStatus.toLowerCase().includes("deliver") ? "secondary" : "outline"}>{deliveryStatus}</Badge> : <span className="inline-flex items-center gap-1.5"><span>{String(row.channelSource || row.salesChannel || row.source || "-")}</span>{isEbayLiveOrder(row) && <EbayLiveMark />}{isTikTokLiveOrder(row) && <TikTokLiveMark />}</span> : String(row.channelSource || row.salesChannel || row.source || "-")}</TableCell>}
            {showAllColumn("destination") && <TableCell>{[String((row.shippingAddress as Record<string, unknown> | undefined)?.city || ""), String((row.shippingAddress as Record<string, unknown> | undefined)?.state || (row.shippingAddress as Record<string, unknown> | undefined)?.province || ""), countryFor(row)].filter(Boolean).join(", ") || "-"}</TableCell>}
            {showAllColumn("updated") && <TableCell>{dateLabel(String(row.updatedAt || row.createdAt || ""))}</TableCell>}
            <TableCell><DropdownMenu><DropdownMenuTrigger asChild><Button size="icon" variant="ghost" title={`${tab === "orders" ? "Order" : "Return"} actions`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{tab === "orders" ? <><DropdownMenuItem asChild><a href={`/orders/${encodeURIComponent(id || reference)}`}>Open order</a></DropdownMenuItem><DropdownMenuItem onSelect={() => void refreshOrderRouting(id)}><RefreshCw className="mr-2 size-4" />Refresh routing</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => void runAction([id], "approve")}>Approve</DropdownMenuItem><DropdownMenuItem onSelect={() => void runAction([id], "hold")}>Put on hold</DropdownMenuItem><DropdownMenuItem onSelect={() => void createSupplierPos([id])}>Create supplier PO(s)</DropdownMenuItem><DropdownMenuItem onSelect={() => void createBackorder(row)}>Create backorder PO</DropdownMenuItem><DropdownMenuItem onSelect={() => void runAction([id], "done")}>Mark done</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem onSelect={() => void runAction([id], "cancel")}>Cancel locally</DropdownMenuItem><DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => void runAction([id], "void")}>Void locally</DropdownMenuItem></> : <><DropdownMenuItem asChild><a href={rmaHref(row)}>Open RMA</a></DropdownMenuItem>{linkedOrderId && <DropdownMenuItem asChild><a href={`/orders/${encodeURIComponent(linkedOrderId)}?tab=returns`}>Open linked order</a></DropdownMenuItem>}<DropdownMenuItem onSelect={() => setTransactionReturn(row)}>Transactions</DropdownMenuItem>{String(row.source || "").toLowerCase() === "shopify" && <DropdownMenuItem onSelect={() => void api(`/api/returns/${encodeURIComponent(id)}/sync-shopify`, { method: "POST" }).then(() => { toast.success("Return sent to Shopify."); return load() }).catch((error: Error) => toast.error(error.message))}>Send to Shopify</DropdownMenuItem>}</>}</DropdownMenuContent></DropdownMenu></TableCell>
          </TableRow>
        })}{!filtered.length && <TableRow><TableCell colSpan={12} className="h-28 text-center text-muted-foreground">No records match the current queue and filters.</TableCell></TableRow>}</TableBody></Table></div>}
        {!loading && filtered.length > pageSize && <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm"><span className="text-muted-foreground">Showing {numberLabel((currentPage - 1) * pageSize + 1)}-{numberLabel(Math.min(currentPage * pageSize, filtered.length))} of {numberLabel(filtered.length)}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={currentPage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button><Button size="sm" variant="outline" disabled={currentPage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>Next</Button></div></div>}
        </>}
      </CardContent>
    </Card>}
    <Dialog open={orderExportOpen} onOpenChange={setOrderExportOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Export orders</DialogTitle><DialogDescription>The export runs in the background against the active filters. Large date ranges continue even if you leave this page.</DialogDescription></DialogHeader><div className="grid gap-4"><Field label="Export format"><RadioGroup value={orderExportMode} onValueChange={setOrderExportMode} className="grid gap-2 sm:grid-cols-2"><Label className="flex cursor-pointer items-start gap-3 rounded-md border p-3"><RadioGroupItem value="summary" className="mt-0.5" /><span><span className="block text-sm font-medium">Order summary</span><span className="block text-xs text-muted-foreground">One row per order with customer, financial, shipping, tracking, return, and cancellation details.</span></span></Label><Label className="flex cursor-pointer items-start gap-3 rounded-md border p-3"><RadioGroupItem value="lines" className="mt-0.5" /><span><span className="block text-sm font-medium">Orders with line items</span><span className="block text-xs text-muted-foreground">One row per item with SKU, title, brand, supplier, quantity, cost, refund, and cancellation fields.</span></span></Label></RadioGroup></Field><Field label="Export scope"><RadioGroup value={orderExportScope} onValueChange={setOrderExportScope} className="grid gap-2 sm:grid-cols-2"><Label className="flex cursor-pointer items-start gap-3 rounded-md border p-3"><RadioGroupItem value="filtered" className="mt-0.5" /><span><span className="block text-sm font-medium">All matching orders</span><span className="block text-xs text-muted-foreground">{numberLabel(filteredTotal)} orders match the current search, date range, and filters.</span></span></Label><Label className={`flex items-start gap-3 rounded-md border p-3 ${selectedIds.size ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}><RadioGroupItem value="selected" disabled={!selectedIds.size} className="mt-0.5" /><span><span className="block text-sm font-medium">Selected orders</span><span className="block text-xs text-muted-foreground">{numberLabel(selectedIds.size)} currently selected orders.</span></span></Label></RadioGroup></Field><Alert><FileDown className="size-4" /><AlertTitle>Download from Jobs</AlertTitle><AlertDescription>The completed CSV is retained as a job artifact and can be downloaded without rerunning the filters.</AlertDescription></Alert></div><DialogFooter><Button variant="outline" disabled={orderExportBusy} onClick={() => setOrderExportOpen(false)}>Cancel</Button><Button disabled={orderExportBusy || (orderExportScope === "selected" && !selectedIds.size) || filteredTotal === 0} onClick={() => void queueOrderExport()}>{orderExportBusy ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />} Queue export</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={saveOrderViewOpen} onOpenChange={setSaveOrderViewOpen}><DialogContent><DialogHeader><DialogTitle>Save shared order view</DialogTitle><DialogDescription>This saves the current filters, applied date range, sort, and visible columns as a live view. Reopening it always runs against current orders.</DialogDescription></DialogHeader><Field label="View name"><Input value={savedOrderViewName} onChange={(event) => setSavedOrderViewName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveSharedOrderView() }} placeholder="Example: Paid orders awaiting shipment" autoFocus /></Field><DialogFooter><Button variant="outline" onClick={() => setSaveOrderViewOpen(false)}>Cancel</Button><Button onClick={() => void saveSharedOrderView()}>Save and activate</Button></DialogFooter></DialogContent></Dialog>
    <Sheet open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}><SheetContent className="w-full overflow-y-auto sm:max-w-2xl"><SheetHeader><SheetTitle>{String(current.orderNumber || current.id || "Order")}</SheetTitle><SheetDescription>Quick operational view. Open the full order for fulfillment, labels, payments, and channel controls.</SheetDescription></SheetHeader>{!detail ? <div className="grid gap-2 py-6"><Skeleton className="h-20" /><Skeleton className="h-20" /></div> : <div className="grid gap-5 py-5"><div className="flex flex-wrap gap-2"><Button size="sm" asChild><a href={`/orders/${encodeURIComponent(String(current.id || current.orderNumber || ""))}`}>Open full order</a></Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void runAction([String(current.id || "")], "hold")}>Put on hold</Button></div><div className="grid gap-3 sm:grid-cols-2"><Detail label="Status" value={String(current.status || "New")} /><Detail label="Allocation" value={String(current.allocationStatus || "Not allocated")} /><Detail label="Total" value={moneyLabel(Number(current.total || 0))} /><Detail label="Source" value={String(current.source || "-")} /></div><Tabs defaultValue="shipments"><TabsList><TabsTrigger value="shipments">Shipments ({currentShipments.length})</TabsTrigger><TabsTrigger value="payments">Payments ({currentPayments.length})</TabsTrigger><TabsTrigger value="items">Items</TabsTrigger></TabsList><TabsContent value="shipments" className="grid gap-2 pt-3">{currentShipments.map((shipment) => <Card key={String(shipment.id)}><CardContent className="p-3 text-sm"><p className="font-medium">{String(shipment.reference || shipment.warehouseName || "Shipment")}</p><p className="text-muted-foreground">{String(shipment.status || "allocated")} / {String(shipment.trackingNumber || "No tracking")}</p></CardContent></Card>)}{!currentShipments.length && <p className="text-sm text-muted-foreground">No shipments have been created.</p>}</TabsContent><TabsContent value="payments" className="grid gap-2 pt-3">{currentPayments.map((payment) => <Card key={String(payment.id)}><CardContent className="flex justify-between p-3 text-sm"><span>{String(payment.provider || "Payment")}</span><span>{moneyLabel(Number(payment.amount || 0))}</span></CardContent></Card>)}{!currentPayments.length && <p className="text-sm text-muted-foreground">No payment events recorded.</p>}</TabsContent><TabsContent value="items" className="grid gap-2 pt-3">{(Array.isArray(current.items) ? current.items as Array<Record<string, unknown>> : []).map((item, index) => <div key={`${String(item.sku)}-${index}`} className="rounded-md border p-3 text-sm"><p className="font-medium">{String(item.title || item.sku || "Item")}</p><p className="text-muted-foreground">{String(item.sku || "-")} / Qty {numberLabel(Number(item.qty || 0))}</p></div>)}</TabsContent></Tabs></div>}<SheetFooter><Button variant="outline" onClick={() => setSelected(null)}>Close</Button></SheetFooter></SheetContent></Sheet>
    <Dialog open={Boolean(transactionReturn)} onOpenChange={(open) => !open && setTransactionReturn(null)}><DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] sm:max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle className="break-all pr-8">{String(transactionReturn?.returnNumber || transactionReturn?.channelReturnId || "Return")}</DialogTitle><DialogDescription>Return details and channel-reported amounts</DialogDescription></DialogHeader>{transactionReturn && <OrderReturnDetails key={String(transactionReturn.id)} record={transactionReturn} trackingUrl={trackingUrlForShipment} defaultTab="transactions" />}</DialogContent></Dialog>
    <Dialog open={historicalBackfillOpen} onOpenChange={(open) => { setHistoricalBackfillOpen(open); if (!open) setHistoricalBackfillConfirmed(false) }}><DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Historical order import</DialogTitle><DialogDescription>Run one channel at a time. This creates missing reporting records without allocating inventory, creating purchase demand, buying labels, or changing normal channel checkpoints.</DialogDescription></DialogHeader><div className="grid gap-4"><Alert><ShieldCheck className="size-4" /><AlertTitle>Operational isolation is enabled</AlertTitle><AlertDescription>Existing DataPlus orders are skipped. Completed and canceled history stays outside operational queues. Any order still open at the channel is held for review.</AlertDescription></Alert><div className="grid gap-4 sm:grid-cols-3"><Field label="Channel"><Select value={historicalBackfillChannel} onValueChange={(channel) => { setHistoricalBackfillChannel(channel); setHistoricalBackfillConfirmed(false) }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["temu", "shopify", "ebay", "walmart"].filter((channel) => historicalBackfillChannels.includes(channel)).map((channel) => <SelectItem key={channel} value={channel}>{channel === "ebay" ? "eBay" : channel[0].toUpperCase() + channel.slice(1)}</SelectItem>)}</SelectContent></Select></Field><Field label="From"><Input type="date" max={historicalBackfillEnd} value={historicalBackfillStart} onChange={(event) => { setHistoricalBackfillStart(event.target.value); setHistoricalBackfillConfirmed(false) }} /></Field><Field label="Through"><Input type="date" min={historicalBackfillStart} max={localDateKey(new Date())} value={historicalBackfillEnd} onChange={(event) => { setHistoricalBackfillEnd(event.target.value); setHistoricalBackfillConfirmed(false) }} /></Field></div>{historicalBackfillChannel === "walmart" && <p className="text-xs text-muted-foreground">Walmart accepts at most 180 days per job. Run the first and second YTD segments separately.</p>}<label className="flex items-start gap-3 rounded-md border p-3 text-sm"><Checkbox checked={historicalBackfillConfirmed} onCheckedChange={(checked) => setHistoricalBackfillConfirmed(checked === true)} /><span>I reviewed the channel and date range. I understand this may be a long-running job and will monitor it in Jobs.</span></label></div><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setHistoricalBackfillOpen(false)}>Cancel</Button><Button disabled={busy || !historicalBackfillConfirmed || !historicalBackfillChannel || !historicalBackfillStart || !historicalBackfillEnd} onClick={() => void queueHistoricalBackfill()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Queue historical import</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={resequenceOpen} onOpenChange={(open) => { setResequenceOpen(open); if (!open) setResequenceConfirmed(false) }}><DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] sm:max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Resequence internal order IDs</DialogTitle><DialogDescription>DataPlus internal IDs will be reassigned oldest to newest by actual order date across every channel. Stable record IDs and channel order numbers stay unchanged.</DialogDescription></DialogHeader>{resequenceLoading && !resequencePreview ? <div className="grid min-h-32 place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div> : resequencePreview ? <div className="grid gap-4"><Alert><AlertTitle>{numberLabel(resequencePreview.orderCount)} orders reviewed</AlertTitle><AlertDescription>{numberLabel(resequencePreview.changedCount)} internal IDs will change, starting at {resequencePreview.startNumber} and ending before {resequencePreview.nextOrderNumber}. The job creates a database backup first and records the old-to-new mapping.</AlertDescription></Alert><div className="grid gap-3 sm:grid-cols-2"><div className="rounded-md border p-3"><p className="text-xs font-medium uppercase text-muted-foreground">Oldest in sequence</p><div className="mt-2 grid gap-1 text-sm">{resequencePreview.first.slice(0, 3).map((row) => <p key={row.orderId} className="flex justify-between gap-2"><span className="truncate">{dateLabel(String(row.orderAt || ""))}</span><span className="font-mono">{row.oldOrderNumber || "-"} → {row.newOrderNumber}</span></p>)}</div></div><div className="rounded-md border p-3"><p className="text-xs font-medium uppercase text-muted-foreground">Newest in sequence</p><div className="mt-2 grid gap-1 text-sm">{resequencePreview.last.slice(-3).map((row) => <p key={row.orderId} className="flex justify-between gap-2"><span className="truncate">{dateLabel(String(row.orderAt || ""))}</span><span className="font-mono">{row.oldOrderNumber || "-"} → {row.newOrderNumber}</span></p>)}</div></div></div><label className="flex items-start gap-3 rounded-md border p-3 text-sm"><Checkbox checked={resequenceConfirmed} onCheckedChange={(checked) => setResequenceConfirmed(checked === true)} /><span>I reviewed this global change. The job will preserve channel references, stable order IDs, tracking, and historical mappings.</span></label></div> : <Alert variant="destructive"><AlertTitle>Preview unavailable</AlertTitle><AlertDescription>Try again after confirming PostgreSQL and the Orders service are available.</AlertDescription></Alert>}<DialogFooter><Button variant="outline" disabled={resequenceLoading} onClick={() => setResequenceOpen(false)}>Cancel</Button><Button disabled={resequenceLoading || !resequencePreview || !resequenceConfirmed} onClick={() => void queueInternalNumberResequence()}>{resequenceLoading ? <Loader2 className="size-4 animate-spin" /> : <ArrowUpDown className="size-4" />} Queue resequence</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={quoteOpen} onOpenChange={setQuoteOpen}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>Create draft quote</DialogTitle><DialogDescription>Create the draft now, then fill in customer, shipping, items, pricing, and notes from the quote workspace. Every field below is optional.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><Field label="Customer name"><Input value={quoteForm.buyer} onChange={(event) => setQuoteForm({ ...quoteForm, buyer: event.target.value })} placeholder="Optional" /></Field><Field label="Customer email"><Input type="email" value={quoteForm.buyerEmail} onChange={(event) => setQuoteForm({ ...quoteForm, buyerEmail: event.target.value })} placeholder="Optional" /></Field><Field label="Phone"><Input value={quoteForm.phone} onChange={(event) => setQuoteForm({ ...quoteForm, phone: event.target.value })} placeholder="Optional" /></Field><Field label="Quote source"><Select value={quoteForm.source} onValueChange={(source) => setQuoteForm({ ...quoteForm, source })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Manual">Manual</SelectItem><SelectItem value="Phone">Phone</SelectItem><SelectItem value="Email">Email</SelectItem><SelectItem value="Shopify">Shopify</SelectItem></SelectContent></Select></Field></div><div className="grid gap-3 rounded-md border bg-muted/20 p-3 sm:grid-cols-2"><p className="sm:col-span-2 text-sm font-medium">Ship-to address</p><Field label="Address line 1"><Input value={quoteForm.line1} onChange={(event) => setQuoteForm({ ...quoteForm, line1: event.target.value })} /></Field><Field label="Address line 2"><Input value={quoteForm.line2} onChange={(event) => setQuoteForm({ ...quoteForm, line2: event.target.value })} /></Field><Field label="City"><Input value={quoteForm.city} onChange={(event) => setQuoteForm({ ...quoteForm, city: event.target.value })} /></Field><Field label="State / province"><Input value={quoteForm.state} onChange={(event) => setQuoteForm({ ...quoteForm, state: event.target.value })} /></Field><Field label="Postal code"><Input value={quoteForm.postalCode} onChange={(event) => setQuoteForm({ ...quoteForm, postalCode: event.target.value })} /></Field><Field label="Country"><Input value={quoteForm.country} onChange={(event) => setQuoteForm({ ...quoteForm, country: event.target.value })} /></Field></div><div className="grid gap-4 sm:grid-cols-2"><Field label="SKU"><Input value={quoteForm.sku} onChange={(event) => setQuoteForm({ ...quoteForm, sku: event.target.value })} placeholder="Optional first line" /></Field><Field label="Product title"><Input value={quoteForm.title} onChange={(event) => setQuoteForm({ ...quoteForm, title: event.target.value })} placeholder="Optional" /></Field><Field label="Quantity"><Input type="number" min="1" value={quoteForm.qty} onChange={(event) => setQuoteForm({ ...quoteForm, qty: event.target.value })} /></Field><Field label="Unit price"><Input type="number" min="0" step="0.01" value={quoteForm.price} onChange={(event) => setQuoteForm({ ...quoteForm, price: event.target.value })} /></Field></div><Field label="Internal note"><Textarea value={quoteForm.note} onChange={(event) => setQuoteForm({ ...quoteForm, note: event.target.value })} placeholder="Terms, follow-up, or customer context" /></Field><DialogFooter><Button variant="outline" onClick={() => setQuoteOpen(false)}>Cancel</Button><Button disabled={busy} onClick={() => void createQuote()}>Create draft</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={returnOpen} onOpenChange={(open) => { setReturnOpen(open); if (!open) { setReturnOrderSearch(""); setReturnOrderResults([]); setReturnOrderDetail(null) } }}><DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Create return</DialogTitle><DialogDescription>Search for the order when needed. DataPlus loads only the selected order instead of preloading the order history.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2 sm:col-span-2"><p className="text-sm font-medium">Order</p>{returnOrderDetail ? <div className="flex items-center justify-between gap-3 rounded-md border p-3"><div className="min-w-0"><p className="truncate font-medium">{String(returnOrderDetail.orderNumber || returnOrderDetail.id || "Order")}</p><p className="truncate text-xs text-muted-foreground">{String(returnOrderDetail.buyer || returnOrderDetail.customerName || returnOrderDetail.channelSource || "Selected order")}</p></div><Button size="sm" variant="outline" onClick={() => { setReturnOrderDetail(null); setReturnForm((current) => ({ ...current, orderId: "" })); setReturnOrderSearch("") }}>Change</Button></div> : <><div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input autoFocus className="pl-9" value={returnOrderSearch} onChange={(event) => setReturnOrderSearch(event.target.value)} placeholder="Search internal or channel order number" />{returnOrderSearching && <Loader2 className="absolute right-2.5 top-2.5 size-4 animate-spin text-muted-foreground" />}</div>{returnOrderSearch.trim().length >= 2 && !returnOrderSearching && <div className="max-h-52 overflow-y-auto rounded-md border">{returnOrderResults.map((result) => <button key={String(result.id)} type="button" className="block w-full border-b px-3 py-2 text-left last:border-0 hover:bg-muted" onClick={() => void selectReturnOrder(result)}><span className="block text-sm font-medium">{String(result.title || result.id || "Order")}</span><span className="block truncate text-xs text-muted-foreground">{String(result.subtitle || result.marketplaceNumber || "")}</span></button>)}{!returnOrderResults.length && <p className="p-3 text-sm text-muted-foreground">No matching order found.</p>}</div>}</>}</div><Field label="Return warehouse"><Select value={returnForm.warehouseId} onValueChange={(warehouseId) => setReturnForm({ ...returnForm, warehouseId })}><SelectTrigger><SelectValue placeholder="Choose warehouse" /></SelectTrigger><SelectContent>{warehouses.map((warehouse) => <SelectItem key={String(warehouse.id)} value={String(warehouse.id)}>{String(warehouse.name || warehouse.code || "Warehouse")}</SelectItem>)}</SelectContent></Select></Field><Field label="Reason"><Input value={returnForm.reason} onChange={(event) => setReturnForm({ ...returnForm, reason: event.target.value })} /></Field><Field label="Condition"><Select value={returnForm.condition} onValueChange={(condition) => setReturnForm({ ...returnForm, condition })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Unknown">Unknown</SelectItem><SelectItem value="New">New</SelectItem><SelectItem value="Opened">Opened</SelectItem><SelectItem value="Damaged">Damaged</SelectItem></SelectContent></Select></Field></div><Field label="Internal note"><Textarea value={returnForm.note} onChange={(event) => setReturnForm({ ...returnForm, note: event.target.value })} /></Field><DialogFooter><Button variant="outline" onClick={() => setReturnOpen(false)}>Cancel</Button><Button disabled={busy || !returnOrderDetail || !warehouses.length} onClick={() => void createReturn()}>Create return</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
