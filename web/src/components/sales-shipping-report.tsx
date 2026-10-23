import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, ChartColumn, Info, Loader2, RefreshCw, Table2 } from "lucide-react"
import { api, dateLabel, moneyLabel, numberLabel } from "@/lib/client-api"
import { readWorkspaceCache, writeWorkspaceCache } from "@/lib/workspace-cache"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ShippingReportLedger, type ShipmentRow } from "@/components/shipping-report-ledger"

const ShippingReportCharts = lazy(() => import("@/components/shipping-report-charts").then((module) => ({ default: module.ShippingReportCharts })))

type ReportRow = Record<string, string | number | boolean | null | undefined>
type ShippingReportData = {
  generatedAt?: string
  summary?: ReportRow
  daily?: ReportRow[]
  carriers?: ReportRow[]
  services?: ReportRow[]
  channels?: ReportRow[]
  states?: ReportRow[]
  providers?: ReportRow[]
  purchaseOrigins?: ReportRow[]
  labelSources?: ReportRow[]
  billingStatuses?: ReportRow[]
  costBases?: ReportRow[]
  billingBases?: ReportRow[]
  dimensionStatuses?: ReportRow[]
  categories?: ReportRow[]
  suppliers?: ReportRow[]
  products?: ReportRow[]
}

type TemuSettlementData = {
  generatedAt?: string
  summary?: ReportRow
  transactionTypes?: ReportRow[]
}

type FilterState = {
  dateBasis: string
  carrier: string
  service: string
  destinationState: string
  purchaseOrigin: string
  labelProvider: string
  billingStatus: string
  costBasis: string
  dimensionStatus: string
  varianceStatus: string
  includeVoided: boolean
}

const defaultFilters: FilterState = {
  dateBasis: "order",
  carrier: "all",
  service: "all",
  destinationState: "all",
  purchaseOrigin: "all",
  labelProvider: "all",
  billingStatus: "all",
  costBasis: "all",
  dimensionStatus: "all",
  varianceStatus: "all",
  includeVoided: false,
}

function amount(row: ReportRow | undefined, key: string) {
  return Number(row?.[key] || 0)
}

function percent(value: unknown) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`
}

function label(value: unknown, fallback = "Unknown") {
  return String(value || fallback).replaceAll("_", " ")
}

function purchaseOriginLabel(value: string) {
  if (value === "dataplus") return "DataPlus"
  if (value === "external") return "Outside DataPlus"
  return "Unknown"
}

function providerLabel(value: string) {
  const normalized = value.toLowerCase()
  if (normalized === "ebay") return "eBay"
  if (normalized === "walmart") return "Walmart"
  if (normalized === "shopify") return "Shopify"
  if (normalized === "temu") return "Temu"
  if (normalized === "veeqo") return "Veeqo"
  return label(value)
}

function metricTone(value: number) {
  return value < 0 ? "text-destructive" : "text-foreground"
}

function Metric({ title, value, note, tone }: { title: string; value: string; note?: string; tone?: string }) {
  return <div className="min-w-0 rounded-md border bg-card px-4 py-3 shadow-sm">
    <p className="text-xs font-medium text-muted-foreground">{title}</p>
    <p className={`mt-1 truncate text-xl font-semibold ${tone || "text-foreground"}`} title={value}>{value}</p>
    {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
  </div>
}

function EconomicsTable({ rows, nameKey, nameLabel }: { rows: ReportRow[]; nameKey: string; nameLabel: string }) {
  return <div className="max-h-[520px] overflow-auto">
    <Table>
      <TableHeader><TableRow><TableHead>{nameLabel}</TableHead><TableHead className="text-right">Shipments</TableHead><TableHead className="text-right">Collected</TableHead><TableHead className="text-right">Expense</TableHead><TableHead className="text-right">Contribution</TableHead><TableHead className="text-right">Avg. cost</TableHead><TableHead className="text-right">Burden</TableHead></TableRow></TableHeader>
      <TableBody>{rows.map((row, index) => <TableRow key={`${String(row[nameKey] || "unknown")}-${index}`}>
        <TableCell className="max-w-56 font-medium"><span className="block truncate" title={String(row[nameKey] || "Unknown")}>{label(row[nameKey])}</span></TableCell>
        <TableCell className="text-right">{numberLabel(row.shipment_count)}</TableCell>
        <TableCell className="text-right">{moneyLabel(row.customer_shipping_collected)}</TableCell>
        <TableCell className="text-right">{moneyLabel(row.shipping_expense)}</TableCell>
        <TableCell className={`text-right ${metricTone(amount(row, "shipping_contribution"))}`}>{moneyLabel(row.shipping_contribution)}</TableCell>
        <TableCell className="text-right">{moneyLabel(row.average_cost)}</TableCell>
        <TableCell className="text-right">{percent(row.shipping_burden)}</TableCell>
      </TableRow>)}{!rows.length && <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No shipping activity matches this view.</TableCell></TableRow>}</TableBody>
    </Table>
  </div>
}

function RateAuditTable({ rows, nameKey, nameLabel }: { rows: ReportRow[]; nameKey: string; nameLabel: string }) {
  return <div className="max-h-[520px] overflow-auto">
    <Table>
      <TableHeader><TableRow><TableHead>{nameLabel}</TableHead><TableHead className="text-right">Shipments</TableHead><TableHead className="text-right">Quoted</TableHead><TableHead className="text-right">Net label purchase</TableHead><TableHead className="text-right">Carrier / channel bill</TableHead><TableHead className="text-right">Difference</TableHead><TableHead className="text-right">Purchase measurements</TableHead></TableRow></TableHeader>
      <TableBody>{rows.map((row, index) => <TableRow key={`${String(row[nameKey] || "unknown")}-${index}`}>
        <TableCell className="max-w-56 font-medium"><span className="block truncate" title={String(row[nameKey] || "Unknown")}>{label(row[nameKey])}</span></TableCell>
        <TableCell className="text-right">{numberLabel(row.shipment_count)}</TableCell>
        <TableCell className="text-right">{moneyLabel(row.quoted_cost)}</TableCell>
        <TableCell className="text-right">{moneyLabel(row.net_purchased_label_cost)}</TableCell>
        <TableCell className="text-right">{moneyLabel(row.matched_billed_cost)}</TableCell>
        <TableCell className={`text-right ${amount(row, "billing_variance") > 0 ? "text-destructive" : amount(row, "billing_variance") < 0 ? "text-emerald-600" : ""}`}>{moneyLabel(row.billing_variance)}</TableCell>
        <TableCell className="text-right">{amount(row, "shipment_count") ? percent(amount(row, "package_coverage_count") / amount(row, "shipment_count")) : "0.0%"}</TableCell>
      </TableRow>)}{!rows.length && <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No carrier billing evidence matches this view.</TableCell></TableRow>}</TableBody>
    </Table>
  </div>
}

function settlementTreatment(category: unknown) {
  const value = String(category || "other")
  if (value === "order_payment") return "Order revenue and selling fees"
  if (value === "refund") return "Refund and fee credit"
  if (value === "shipping_label") return "Outbound shipping expense"
  if (value === "shipping_adjustment") return "Outbound shipping adjustment"
  if (value.startsWith("return_shipping")) return value.includes("covered") ? "Platform-covered return shipping" : value.includes("credit") ? "Return shipping credit" : "Return shipping expense"
  if (value === "advertising_fee") return "Advertising overhead"
  if (value === "chargeback_fee") return "Chargeback fee"
  if (value === "fraudulent_fulfillment_deduction") return "Fulfillment deduction"
  if (value === "platform_reimbursement") return "Platform reimbursement"
  if (value.startsWith("payout_transfer")) return "Cash movement only"
  return "Needs accounting review"
}

function TemuSettlementTable({ rows }: { rows: ReportRow[] }) {
  return <div className="overflow-x-auto">
    <Table>
      <TableHeader><TableRow><TableHead className="min-w-64">Transaction type</TableHead><TableHead className="min-w-56">Accounting treatment</TableHead><TableHead className="text-right">Rows</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Matched</TableHead><TableHead className="text-right">Unmatched</TableHead><TableHead className="text-right">Statement amount</TableHead><TableHead className="text-right">Shipping impact</TableHead><TableHead className="text-right">Fee impact</TableHead></TableRow></TableHeader>
      <TableBody>{rows.map((row, index) => <TableRow key={`${String(row.transaction_type || "unknown")}-${index}`}>
        <TableCell><p className="font-medium">{String(row.transaction_type || "Unknown")}</p><p className="text-xs text-muted-foreground">{row.last_transaction_at ? dateLabel(String(row.last_transaction_at)) : "No transaction date"}</p></TableCell>
        <TableCell className="text-sm">{settlementTreatment(row.category)}</TableCell>
        <TableCell className="text-right">{numberLabel(row.transaction_count)}</TableCell>
        <TableCell className="text-right">{numberLabel(row.order_count)}</TableCell>
        <TableCell className="text-right text-emerald-600">{numberLabel(row.matched_count)}</TableCell>
        <TableCell className={`text-right ${amount(row, "unmatched_count") ? "text-destructive" : ""}`}>{numberLabel(row.unmatched_count)}</TableCell>
        <TableCell className={`text-right ${amount(row, "statement_amount") < 0 ? "text-destructive" : ""}`}>{moneyLabel(row.statement_amount)}</TableCell>
        <TableCell className={`text-right ${amount(row, "shipping_cost_amount") < 0 ? "text-emerald-600" : ""}`}>{moneyLabel(row.shipping_cost_amount)}</TableCell>
        <TableCell className={`text-right ${amount(row, "fee_amount") < 0 ? "text-emerald-600" : ""}`}>{moneyLabel(row.fee_amount)}</TableCell>
      </TableRow>)}{!rows.length && <TableRow><TableCell colSpan={9} className="h-28 text-center text-muted-foreground">No Temu settlement transactions match this period.</TableCell></TableRow>}</TableBody>
    </Table>
  </div>
}

function AllocationTable({ rows, nameKey, nameLabel, product = false }: { rows: ReportRow[]; nameKey: string; nameLabel: string; product?: boolean }) {
  return <div className="max-h-[560px] overflow-auto">
    <Table>
      <TableHeader><TableRow><TableHead>{nameLabel}</TableHead><TableHead className="text-right">Orders</TableHead><TableHead className="text-right">Units</TableHead><TableHead className="text-right">Product sales</TableHead><TableHead className="text-right">Allocated shipping</TableHead><TableHead className="text-right">Contribution</TableHead><TableHead className="text-right">Burden</TableHead></TableRow></TableHeader>
      <TableBody>{rows.map((row, index) => <TableRow key={`${String(row[nameKey] || "unknown")}-${index}`}>
        <TableCell className="min-w-52 max-w-72"><span className="block truncate font-medium" title={String(row[nameKey] || "Unknown")}>{product ? <a className="hover:underline" href={`/products/${encodeURIComponent(String(row[nameKey] || ""))}`}>{label(row[nameKey])}</a> : label(row[nameKey])}</span>{product ? <span className="block truncate text-xs text-muted-foreground" title={String(row.title || "")}>{String(row.title || row.supplier || "")}</span> : null}</TableCell>
        <TableCell className="text-right">{numberLabel(row.order_count)}</TableCell>
        <TableCell className="text-right">{numberLabel(row.units)}</TableCell>
        <TableCell className="text-right">{moneyLabel(row.product_sales)}</TableCell>
        <TableCell className="text-right">{moneyLabel(row.shipping_expense)}</TableCell>
        <TableCell className={`text-right ${metricTone(amount(row, "shipping_contribution"))}`}>{moneyLabel(row.shipping_contribution)}</TableCell>
        <TableCell className="text-right">{percent(row.shipping_burden)}</TableCell>
      </TableRow>)}{!rows.length && <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No line-item allocation data matches this view.</TableCell></TableRow>}</TableBody>
    </Table>
  </div>
}

export function SalesShippingReport({
  from,
  to,
  channel,
  active,
  hideHeading = false,
  onChannelsChange,
}: {
  from: string
  to: string
  channel: string
  active: boolean
  hideHeading?: boolean
  onChannelsChange?: (channels: string[]) => void
}) {
  const [tab, setTab] = useState("overview")
  const [overviewMode, setOverviewMode] = useState<"charts" | "data">("charts")
  const [filters, setFilters] = useState<FilterState>(defaultFilters)
  const [data, setData] = useState<ShippingReportData>({})
  const [rows, setRows] = useState<ShipmentRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [query, setQuery] = useState("")
  const [appliedQuery, setAppliedQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [profitabilityLoading, setProfitabilityLoading] = useState(false)
  const [temuSettlements, setTemuSettlements] = useState<TemuSettlementData>({})
  const [temuSettlementsLoading, setTemuSettlementsLoading] = useState(false)
  const [rowsLoading, setRowsLoading] = useState(false)
  const [error, setError] = useState("")
  const summaryRequest = useRef<AbortController | null>(null)
  const profitabilityRequest = useRef<AbortController | null>(null)
  const profitabilityKey = useRef("")
  const temuSettlementsRequest = useRef<AbortController | null>(null)
  const temuSettlementsKey = useRef("")
  const rowsRequest = useRef<AbortController | null>(null)

  const baseParams = useMemo(() => {
    const params = new URLSearchParams({ from, to, dateBasis: filters.dateBasis })
    if (channel && channel !== "all") params.set("channel", channel)
    if (filters.carrier !== "all") params.set("carrier", filters.carrier)
    if (filters.service !== "all") params.set("service", filters.service)
    if (filters.destinationState !== "all") params.set("destinationState", filters.destinationState)
    if (filters.purchaseOrigin !== "all") params.set("purchaseOrigin", filters.purchaseOrigin)
    if (filters.labelProvider !== "all") params.set("labelProvider", filters.labelProvider)
    if (filters.billingStatus !== "all") params.set("billingStatus", filters.billingStatus)
    if (filters.costBasis !== "all") params.set("costBasis", filters.costBasis)
    if (filters.dimensionStatus !== "all") params.set("dimensionStatus", filters.dimensionStatus)
    if (filters.varianceStatus !== "all") params.set("varianceStatus", filters.varianceStatus)
    if (filters.includeVoided) params.set("includeVoided", "true")
    return params
  }, [from, to, channel, filters])

  async function loadSummary() {
    if (!active || !from || !to) return
    summaryRequest.current?.abort()
    const controller = new AbortController()
    summaryRequest.current = controller
    const params = new URLSearchParams(baseParams)
    params.set("includeProfitability", "false")
    const cacheKey = `reports:shipping:${params.toString()}`
    const cached = readWorkspaceCache<ShippingReportData>(cacheKey)
    if (cached) {
      setData((current) => ({
        ...cached,
        ...(profitabilityKey.current === baseParams.toString() ? { categories: current.categories, suppliers: current.suppliers, products: current.products } : {}),
      }))
      onChannelsChange?.((cached.channels || []).map((row) => String(row.channel || "")).filter(Boolean))
    }
    setLoading(!cached)
    try {
      const requestKey = baseParams.toString()
      const result = await api<ShippingReportData>(`/api/reports/sales/shipping?${params}`, { signal: controller.signal })
      if (!controller.signal.aborted) {
        writeWorkspaceCache(cacheKey, result)
        setData((current) => ({
          ...result,
          ...(profitabilityKey.current === requestKey ? { categories: current.categories, suppliers: current.suppliers, products: current.products } : {}),
        }))
        onChannelsChange?.((result.channels || []).map((row) => String(row.channel || "")).filter(Boolean))
        setError("")
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load shipping reporting.")
    } finally {
      if (summaryRequest.current === controller) { summaryRequest.current = null; setLoading(false) }
    }
  }

  async function loadProfitability() {
    if (!active || !from || !to) return
    const requestKey = baseParams.toString()
    if (profitabilityKey.current === requestKey) return
    profitabilityRequest.current?.abort()
    const controller = new AbortController()
    profitabilityRequest.current = controller
    setProfitabilityLoading(true)
    try {
      const params = new URLSearchParams(baseParams)
      params.set("includeProfitability", "true")
      const result = await api<ShippingReportData>(`/api/reports/sales/shipping?${params}`, { signal: controller.signal })
      if (!controller.signal.aborted) {
        profitabilityKey.current = requestKey
        setData((current) => ({ ...current, categories: result.categories || [], suppliers: result.suppliers || [], products: result.products || [] }))
        setError("")
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load shipping profitability.")
    } finally {
      if (profitabilityRequest.current === controller) { profitabilityRequest.current = null; setProfitabilityLoading(false) }
    }
  }

  async function loadRows(nextPage = page, nextQuery = appliedQuery) {
    if (!active || !from || !to) return
    rowsRequest.current?.abort()
    const controller = new AbortController()
    rowsRequest.current = controller
    setRowsLoading(true)
    try {
      const params = new URLSearchParams(baseParams)
      params.set("page", String(nextPage))
      params.set("pageSize", String(pageSize))
      if (nextQuery.trim()) params.set("q", nextQuery.trim())
      const result = await api<{ rows?: ShipmentRow[]; total?: number; page?: number }>(`/api/reports/sales/shipping/shipments?${params}`, { signal: controller.signal })
      if (!controller.signal.aborted) { setRows(result.rows || []); setTotal(Number(result.total || 0)); setPage(Number(result.page || nextPage)) }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load shipment details.")
    } finally {
      if (rowsRequest.current === controller) { rowsRequest.current = null; setRowsLoading(false) }
    }
  }

  async function loadTemuSettlements() {
    if (!active || !from || !to) return
    const params = new URLSearchParams({ from, to })
    if (channel && channel !== "all") params.set("channel", channel)
    const requestKey = params.toString()
    if (temuSettlementsKey.current === requestKey) return
    temuSettlementsRequest.current?.abort()
    const controller = new AbortController()
    temuSettlementsRequest.current = controller
    setTemuSettlementsLoading(true)
    try {
      const result = await api<TemuSettlementData>(`/api/reports/sales/shipping/temu-settlements?${params}`, { signal: controller.signal })
      if (!controller.signal.aborted) {
        temuSettlementsKey.current = requestKey
        setTemuSettlements(result)
        setError("")
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load Temu settlement transactions.")
    } finally {
      if (temuSettlementsRequest.current === controller) { temuSettlementsRequest.current = null; setTemuSettlementsLoading(false) }
    }
  }

  useEffect(() => {
    if (!active) return
    profitabilityRequest.current?.abort()
    temuSettlementsRequest.current?.abort()
    profitabilityKey.current = ""
    temuSettlementsKey.current = ""
    setPage(1)
    setData((current) => ({ ...current, categories: [], suppliers: [], products: [] }))
    void loadSummary()
    return () => { summaryRequest.current?.abort(); profitabilityRequest.current?.abort(); temuSettlementsRequest.current?.abort() }
  }, [active, baseParams.toString()])

  useEffect(() => {
    if (!active || tab !== "profitability") return
    void loadProfitability()
    return () => { profitabilityRequest.current?.abort() }
  }, [active, tab, baseParams.toString()])

  useEffect(() => {
    if (!active || tab !== "shipments") return
    setPage(1)
    void loadRows(1, appliedQuery)
    return () => { rowsRequest.current?.abort() }
  }, [active, tab, baseParams.toString(), pageSize, appliedQuery])

  useEffect(() => {
    if (!active || tab !== "settlements") return
    void loadTemuSettlements()
    return () => { temuSettlementsRequest.current?.abort() }
  }, [active, tab, from, to, channel])

  const summary = data.summary || {}
  const unreconciledCount = Math.max(0, amount(summary, "shipment_count") - amount(summary, "billed_count"))
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const exportParams = new URLSearchParams(baseParams)
  if (appliedQuery) exportParams.set("q", appliedQuery)
  const filterOptions = (source: ReportRow[] | undefined, key: string) => [...new Set((source || []).map((row) => String(row[key] || "")).filter(Boolean))]
  const carrierOptions = filterOptions(data.carriers, "carrier")
  const serviceOptions = filterOptions(data.services, "service")
  const stateOptions = filterOptions(data.states, "destination_state")
  const purchaseOriginOptions = filterOptions(data.purchaseOrigins, "purchase_origin")
  const labelProviderOptions = filterOptions(data.providers, "provider")
  const billingStatusOptions = filterOptions(data.billingStatuses, "billing_status")
  const resetFilters = () => { setFilters(defaultFilters); setQuery(""); setAppliedQuery(""); setPage(1) }
  const applySearch = () => { setAppliedQuery(query.trim()); setPage(1) }
  const temuSummary = temuSettlements.summary || {}
  const temuPurchasedCost = amount(temuSummary, "purchased_shipping_cost")
  const temuMatchedBilled = amount(temuSummary, "matched_shipping_cost")

  return <div className="grid min-w-0 gap-5">
    <div className={`flex flex-wrap items-start gap-3 ${hideHeading ? "justify-end" : "justify-between"}`}>
      {!hideHeading ? <div><h2 className="text-lg font-semibold">Shipping report</h2><p className="text-sm text-muted-foreground">Reconcile the cost paid when each label was purchased against the later carrier or channel bill.</p></div> : null}
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={loading || (tab === "shipments" && rowsLoading) || (tab === "profitability" && profitabilityLoading) || (tab === "settlements" && temuSettlementsLoading)} onClick={() => { void loadSummary(); if (tab === "shipments") void loadRows(1); if (tab === "profitability") { profitabilityKey.current = ""; void loadProfitability() } if (tab === "settlements") { temuSettlementsKey.current = ""; void loadTemuSettlements() } }}>{loading || (tab === "shipments" && rowsLoading) || (tab === "profitability" && profitabilityLoading) || (tab === "settlements" && temuSettlementsLoading) ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button></div>
    </div>

    {error ? <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Shipping report could not load</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    {loading && !data.generatedAt ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-24" />)}</div> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric title="Original label purchases" value={moneyLabel(summary.estimated_shipping_cost)} note="Amount recorded when labels were purchased" />
        <Metric title="Net label purchase cost" value={moneyLabel(summary.net_purchased_label_cost)} note={`${moneyLabel(summary.refunded_cost)} in refunds or void credits`} />
        <Metric title="Matched purchase cost" value={moneyLabel(summary.reconciled_purchase_cost)} note={`${numberLabel(summary.billed_count)} of ${numberLabel(summary.shipment_count)} shipments reconciled`} />
        <Metric title="Carrier / channel billed" value={moneyLabel(summary.matched_billed_cost)} note="Final bill for the same comparable shipments" />
        <Metric title="Billing difference" value={moneyLabel(summary.billing_variance)} tone={amount(summary, "billing_variance") > 0 ? "text-destructive" : metricTone(amount(summary, "billing_variance"))} note="Final bill minus matched label purchase cost" />
        <Metric title="Awaiting settlement" value={moneyLabel(summary.unreconciled_purchase_cost)} note={`${numberLabel(unreconciledCount)} shipments do not have a final bill`} />
        <Metric title="Label purchase measurement coverage" value={percent(summary.package_coverage)} note={`${numberLabel(summary.missing_package_count)} need purchase measurements`} />
        <Metric title="Customer shipping collected" value={moneyLabel(summary.customer_shipping_collected)} note="Revenue, not carrier expense" />
      </div>
      <Card><CardContent className="flex flex-wrap items-end gap-2 p-4">
        <div className="grid gap-1"><Label className="text-xs">Date basis</Label><Select value={filters.dateBasis} onValueChange={(dateBasis) => setFilters((current) => ({ ...current, dateBasis }))}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="order">Order date</SelectItem><SelectItem value="activity">Label activity date</SelectItem><SelectItem value="shipped">Ship date</SelectItem></SelectContent></Select></div>
        <div className="grid gap-1"><Label className="text-xs">Carrier</Label><Select value={filters.carrier} onValueChange={(carrier) => setFilters((current) => ({ ...current, carrier, service: "all" }))}><SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All carriers</SelectItem>{carrierOptions.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid gap-1"><Label className="text-xs">Service</Label><Select value={filters.service} onValueChange={(service) => setFilters((current) => ({ ...current, service }))}><SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All services</SelectItem>{serviceOptions.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid gap-1"><Label className="text-xs">Destination</Label><Select value={filters.destinationState} onValueChange={(destinationState) => setFilters((current) => ({ ...current, destinationState }))}><SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All states</SelectItem>{stateOptions.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid gap-1"><Label className="text-xs">Cost basis</Label><Select value={filters.costBasis} onValueChange={(costBasis) => setFilters((current) => ({ ...current, costBasis }))}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All costs</SelectItem><SelectItem value="reconciled">Reconciled bill</SelectItem><SelectItem value="estimated">Awaiting settlement</SelectItem><SelectItem value="missing">Missing label cost</SelectItem><SelectItem value="adjusted">Provisional adjustment</SelectItem><SelectItem value="refunded">Refund / credit</SelectItem></SelectContent></Select></div>
        <div className="grid gap-1"><Label className="text-xs">Purchased through</Label><Select value={filters.purchaseOrigin} onValueChange={(purchaseOrigin) => setFilters((current) => ({ ...current, purchaseOrigin }))}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All workflows</SelectItem>{purchaseOriginOptions.map((value) => <SelectItem key={value} value={value}>{purchaseOriginLabel(value)}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid gap-1"><Label className="text-xs">Label provider</Label><Select value={filters.labelProvider} onValueChange={(labelProvider) => setFilters((current) => ({ ...current, labelProvider }))}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All providers</SelectItem>{labelProviderOptions.map((value) => <SelectItem key={value} value={value}>{providerLabel(value)}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid gap-1"><Label className="text-xs">Billing</Label><Select value={filters.billingStatus} onValueChange={(billingStatus) => setFilters((current) => ({ ...current, billingStatus }))}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All billing states</SelectItem>{billingStatusOptions.map((value) => <SelectItem key={value} value={value}>{label(value)}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid gap-1"><Label className="text-xs">Measurements</Label><Select value={filters.dimensionStatus} onValueChange={(dimensionStatus) => setFilters((current) => ({ ...current, dimensionStatus }))}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All measurements</SelectItem><SelectItem value="complete">Complete</SelectItem><SelectItem value="missing_weight">Missing weight</SelectItem><SelectItem value="missing_dimensions">Missing dimensions</SelectItem><SelectItem value="missing_all">Missing weight and dimensions</SelectItem></SelectContent></Select></div>
        <div className="grid gap-1"><Label className="text-xs">Billing difference</Label><Select value={filters.varianceStatus} onValueChange={(varianceStatus) => setFilters((current) => ({ ...current, varianceStatus }))}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All shipments</SelectItem><SelectItem value="billed">Reconciled only</SelectItem><SelectItem value="over">Billed higher</SelectItem><SelectItem value="under">Billed lower</SelectItem><SelectItem value="matching">Matches purchase</SelectItem></SelectContent></Select></div>
        <label className="mb-2 flex items-center gap-2 text-sm"><Checkbox checked={filters.includeVoided} onCheckedChange={(checked) => setFilters((current) => ({ ...current, includeVoided: checked === true }))} />Include voided labels</label>
        <Button size="sm" variant="ghost" className="h-9" onClick={resetFilters}>Clear</Button>
      </CardContent></Card>
      {unreconciledCount > 0 ? <Alert className="border-amber-500/40 bg-amber-500/10"><Info className="size-4" /><AlertTitle>{numberLabel(unreconciledCount)} shipments are awaiting a final carrier or channel bill</AlertTitle><AlertDescription>Their {moneyLabel(summary.unreconciled_purchase_cost)} label purchase cost remains visible. It will not be included in the billing difference until a carrier invoice or channel settlement is matched.</AlertDescription></Alert> : null}
      {amount(summary, "billed_without_purchase_count") > 0 ? <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>{numberLabel(summary.billed_without_purchase_count)} billed shipments are missing their original label purchase cost</AlertTitle><AlertDescription>The {moneyLabel(summary.billed_without_purchase_cost)} final bill remains in accounting expense, but those rows are excluded from purchase-versus-bill comparison until the original purchase evidence is recovered.</AlertDescription></Alert> : null}
      {amount(summary, "canceled_order_shipment_count") > 0 ? <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>{numberLabel(summary.canceled_order_shipment_count)} shipment records belong to canceled orders</AlertTitle><AlertDescription>These expenses remain visible because a purchased or shipped label can still cost money even when its sales order was canceled.</AlertDescription></Alert> : null}

      <Tabs value={tab} onValueChange={setTab} className="min-w-0">
        <div className="max-w-full overflow-x-auto rounded-md border bg-card p-1"><TabsList className="h-auto min-w-max justify-start bg-transparent p-0"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="costs">Carrier billing audit</TabsTrigger><TabsTrigger value="settlements">Channel settlements</TabsTrigger><TabsTrigger value="profitability">Shipping profitability</TabsTrigger><TabsTrigger value="shipments">Shipment ledger</TabsTrigger><TabsTrigger value="definitions">Metric notes</TabsTrigger></TabsList></div>
        <TabsContent value="overview" className="mt-5 grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-sm font-medium">Shipping overview</h3><p className="text-xs text-muted-foreground">Use charts for patterns or raw data for exact accounting values.</p></div>
            <ButtonGroup aria-label="Shipping overview display">
              <Button size="sm" variant={overviewMode === "charts" ? "default" : "outline"} aria-pressed={overviewMode === "charts"} onClick={() => setOverviewMode("charts")}><ChartColumn className="size-4" />Charts</Button>
              <Button size="sm" variant={overviewMode === "data" ? "default" : "outline"} aria-pressed={overviewMode === "data"} onClick={() => setOverviewMode("data")}><Table2 className="size-4" />Raw data</Button>
            </ButtonGroup>
          </div>
          {overviewMode === "charts" ? <Suspense fallback={<div className="grid gap-5 xl:grid-cols-2">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-[390px]" />)}</div>}>
            <ShippingReportCharts daily={data.daily || []} channels={data.channels || []} states={data.states || []} dimensionStatuses={data.dimensionStatuses || []} />
          </Suspense> : <div className="grid gap-5 xl:grid-cols-2">
            <Card><CardHeader><CardTitle className="text-base">Shipping expense over time</CardTitle><CardDescription>Daily expense uses the selected date basis and excludes voided labels unless included above.</CardDescription></CardHeader><CardContent className="p-0"><EconomicsTable rows={data.daily || []} nameKey="date" nameLabel="Date" /></CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Expense by channel</CardTitle><CardDescription>Order channel and label source remain separate dimensions.</CardDescription></CardHeader><CardContent className="p-0"><EconomicsTable rows={data.channels || []} nameKey="channel" nameLabel="Channel" /></CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Destination states</CardTitle><CardDescription>Use shipping burden to find destinations where label expense consumes more revenue.</CardDescription></CardHeader><CardContent className="p-0"><EconomicsTable rows={data.states || []} nameKey="destination_state" nameLabel="State" /></CardContent></Card>
            <Card><CardHeader><CardTitle className="text-base">Reconciliation coverage</CardTitle><CardDescription>Label purchase cost remains the starting value until a carrier or channel bill is matched.</CardDescription></CardHeader><CardContent className="p-0"><EconomicsTable rows={data.costBases || []} nameKey="cost_basis" nameLabel="Status" /></CardContent></Card>
          </div>}
        </TabsContent>
        <TabsContent value="costs" className="mt-5 grid gap-5 xl:grid-cols-2">
          <Card><CardHeader><CardTitle className="text-base">Label purchases versus bills by carrier</CardTitle><CardDescription>Positive difference means the carrier or channel billed more than the net label purchase cost.</CardDescription></CardHeader><CardContent className="p-0"><RateAuditTable rows={data.carriers || []} nameKey="carrier" nameLabel="Carrier" /></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Label purchases versus bills by service</CardTitle><CardDescription>Use service-level differences to isolate repeated reweighs, dimensional corrections, and surcharges.</CardDescription></CardHeader><CardContent className="p-0"><RateAuditTable rows={data.services || []} nameKey="service" nameLabel="Service" /></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Label purchases versus bills by channel</CardTitle><CardDescription>Temu and other channel billing remains separate from the original label purchase.</CardDescription></CardHeader><CardContent className="p-0"><RateAuditTable rows={data.channels || []} nameKey="channel" nameLabel="Channel" /></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Cost evidence</CardTitle><CardDescription>Carrier invoice, matched settlement, recorded adjustment, label purchase, quote-only, or missing evidence.</CardDescription></CardHeader><CardContent className="p-0"><RateAuditTable rows={data.billingBases || []} nameKey="billing_basis" nameLabel="Evidence" /></CardContent></Card>
          <Card className="xl:col-span-2"><CardHeader><CardTitle className="text-base">Package measurement quality</CardTitle><CardDescription>Missing weight or dimensions makes carrier re-rating and charge disputes difficult to verify.</CardDescription></CardHeader><CardContent className="p-0"><RateAuditTable rows={data.dimensionStatuses || []} nameKey="dimension_status" nameLabel="Measurement status" /></CardContent></Card>
        </TabsContent>
        <TabsContent value="settlements" className="mt-5 grid gap-5">
          {temuSettlementsLoading && !temuSettlements.generatedAt ? <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-24" />)}</div><Skeleton className="h-[420px]" /></> : <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Metric title="DataPlus purchased labels" value={moneyLabel(temuPurchasedCost)} note={`${numberLabel(temuSummary.purchased_shipment_count)} Temu label records in this activity period`} />
              <Metric title="Temu statement shipping" value={moneyLabel(temuSummary.shipping_cost_amount)} note={`${moneyLabel(temuSummary.return_shipping_cost)} is return shipping`} />
              <Metric title="Matched Temu billing" value={moneyLabel(temuMatchedBilled)} note={`${moneyLabel(temuSummary.unmatched_shipping_cost)} still unmatched`} />
              <Metric title="Matched variance" value={moneyLabel(temuMatchedBilled - temuPurchasedCost)} tone={temuMatchedBilled - temuPurchasedCost > 0 ? "text-destructive" : metricTone(temuMatchedBilled - temuPurchasedCost)} note={`${moneyLabel(temuSummary.shipping_adjustments)} in label adjustments`} />
            </div>
            <Alert><Info className="size-4" /><AlertTitle>Transactions are classified before they reach shipping totals</AlertTitle><AlertDescription>Only outbound and return label charges, adjustments, and shipping credits affect Temu shipping expense. Order payments, refunds, advertising, reimbursements, chargebacks, fraud deductions, and transfers remain visible below but flow to their proper accounting categories.</AlertDescription></Alert>
            <Card><CardHeader><CardTitle className="text-base">Temu settlement transaction breakdown</CardTitle><CardDescription>Statement amount preserves Temu's signed debit or credit. Shipping and fee impacts use positive numbers for expenses and negative numbers for credits. The period uses each settlement transaction date.</CardDescription></CardHeader><CardContent className="p-0"><TemuSettlementTable rows={temuSettlements.transactionTypes || []} /></CardContent></Card>
          </>}
        </TabsContent>
        <TabsContent value="profitability" className="mt-5 grid gap-5 xl:grid-cols-2">
          {profitabilityLoading ? <><Skeleton className="h-[360px]" /><Skeleton className="h-[360px]" /><Skeleton className="h-[420px] xl:col-span-2" /></> : <>
          <Card><CardHeader><CardTitle className="text-base">Categories</CardTitle><CardDescription>Order shipping is allocated to lines by merchandise sales, then quantity, then evenly when neither is available.</CardDescription></CardHeader><CardContent className="p-0"><AllocationTable rows={data.categories || []} nameKey="category" nameLabel="Category" /></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Suppliers</CardTitle><CardDescription>Allocated shipping burden for merchandise sourced from each supplier.</CardDescription></CardHeader><CardContent className="p-0"><AllocationTable rows={data.suppliers || []} nameKey="supplier" nameLabel="Supplier" /></CardContent></Card>
          <Card className="xl:col-span-2"><CardHeader><CardTitle className="text-base">SKUs with the highest shipping expense</CardTitle><CardDescription>Use burden and contribution to identify products whose shipping economics need pricing or packaging review.</CardDescription></CardHeader><CardContent className="p-0"><AllocationTable rows={data.products || []} nameKey="sku" nameLabel="SKU / product" product /></CardContent></Card>
          </>}
        </TabsContent>
        <TabsContent value="shipments" className="mt-5">
          <ShippingReportLedger
            rows={rows}
            loading={rowsLoading}
            total={total}
            page={page}
            totalPages={totalPages}
            pageSize={pageSize}
            query={query}
            exportParams={exportParams}
            onQueryChange={setQuery}
            onSearch={applySearch}
            onPageChange={(nextPage) => void loadRows(nextPage)}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1) }}
          />
        </TabsContent>
        <TabsContent value="definitions" className="mt-5 grid gap-5 lg:grid-cols-2">
          <Card><CardHeader><CardTitle className="text-base">Financial definitions</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm text-muted-foreground"><p><strong className="text-foreground">Original label purchase cost</strong> is the amount recorded when the label was bought. It is never overwritten by a later invoice or settlement.</p><p><strong className="text-foreground">Net label purchase cost</strong> is the original purchase less a label refund or void credit.</p><p><strong className="text-foreground">Carrier or channel billed cost</strong> is populated only from matched external billing evidence. <strong className="text-foreground">Billing difference</strong> is that final bill minus the net label purchase cost for the same shipment.</p><p><strong className="text-foreground">Shipping expense used in P&amp;L</strong> uses the final billed cost when reconciled; otherwise it uses net label purchase cost plus provisional recorded adjustments.</p><p><strong className="text-foreground">Customer-paid shipping revenue</strong> is order revenue and is never substituted for label or carrier expense.</p></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Measurements, allocation, and export</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm text-muted-foreground"><p><strong className="text-foreground">Label purchase measurements</strong> are the weight and dimensions DataPlus sent when obtaining the original rate or label.</p><p><strong className="text-foreground">Carrier-reported measurements</strong> come later from a carrier invoice or channel settlement and never overwrite the purchase measurements.</p><p>Purchase DIM weight uses label purchase length x width x height divided by 139. Carrier-rated weight and dimensions remain separate billing evidence.</p><p>Order-level shipping revenue and sales are divided across active shipment records so multi-label orders are not counted more than once.</p><p>Category, supplier, and SKU views allocate shipping economics by merchandise sales, then quantity, then evenly.</p><p>Label purchase measurement coverage is currently {percent(summary.package_coverage)}. Missing dimensions or weight remain visible and are never inferred.</p><p>Displayed columns and saved export templates are private to the signed-in user. Templates save columns, while the current dates and filters apply when the file is downloaded.</p><p>CSV exports are capped at 25,000 rows per request to protect the operational server.</p></CardContent></Card>
        </TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground">Generated {dateLabel(data.generatedAt)}. Original label purchase amounts remain preserved; matched carrier invoices and channel settlements supply the separate final billed cost.</p>
    </>}
  </div>
}
