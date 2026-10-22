import { useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, Info, Loader2, RefreshCw } from "lucide-react"
import { api, dateLabel, moneyLabel, numberLabel } from "@/lib/client-api"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ShippingReportLedger, type ShipmentRow } from "@/components/shipping-report-ledger"

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
  labelSources?: ReportRow[]
  billingStatuses?: ReportRow[]
  costBases?: ReportRow[]
  billingBases?: ReportRow[]
  dimensionStatuses?: ReportRow[]
  categories?: ReportRow[]
  suppliers?: ReportRow[]
  products?: ReportRow[]
}

type FilterState = {
  dateBasis: string
  carrier: string
  service: string
  destinationState: string
  labelSource: string
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
  labelSource: "all",
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
      <TableHeader><TableRow><TableHead>{nameLabel}</TableHead><TableHead className="text-right">Shipments</TableHead><TableHead className="text-right">Quoted</TableHead><TableHead className="text-right">Purchased</TableHead><TableHead className="text-right">Billed</TableHead><TableHead className="text-right">Variance</TableHead><TableHead className="text-right">Measurements</TableHead></TableRow></TableHeader>
      <TableBody>{rows.map((row, index) => <TableRow key={`${String(row[nameKey] || "unknown")}-${index}`}>
        <TableCell className="max-w-56 font-medium"><span className="block truncate" title={String(row[nameKey] || "Unknown")}>{label(row[nameKey])}</span></TableCell>
        <TableCell className="text-right">{numberLabel(row.shipment_count)}</TableCell>
        <TableCell className="text-right">{moneyLabel(row.quoted_cost)}</TableCell>
        <TableCell className="text-right">{moneyLabel(row.estimated_shipping_cost)}</TableCell>
        <TableCell className="text-right">{moneyLabel(row.billed_shipping_cost)}</TableCell>
        <TableCell className={`text-right ${amount(row, "billing_variance") > 0 ? "text-destructive" : amount(row, "billing_variance") < 0 ? "text-emerald-600" : ""}`}>{moneyLabel(row.billing_variance)}</TableCell>
        <TableCell className="text-right">{amount(row, "shipment_count") ? percent(amount(row, "package_coverage_count") / amount(row, "shipment_count")) : "0.0%"}</TableCell>
      </TableRow>)}{!rows.length && <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No carrier billing evidence matches this view.</TableCell></TableRow>}</TableBody>
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
  const [filters, setFilters] = useState<FilterState>(defaultFilters)
  const [data, setData] = useState<ShippingReportData>({})
  const [rows, setRows] = useState<ShipmentRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [query, setQuery] = useState("")
  const [appliedQuery, setAppliedQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [rowsLoading, setRowsLoading] = useState(false)
  const [error, setError] = useState("")
  const summaryRequest = useRef<AbortController | null>(null)
  const rowsRequest = useRef<AbortController | null>(null)

  const baseParams = useMemo(() => {
    const params = new URLSearchParams({ from, to, dateBasis: filters.dateBasis })
    if (channel && channel !== "all") params.set("channel", channel)
    if (filters.carrier !== "all") params.set("carrier", filters.carrier)
    if (filters.service !== "all") params.set("service", filters.service)
    if (filters.destinationState !== "all") params.set("destinationState", filters.destinationState)
    if (filters.labelSource !== "all") params.set("labelSource", filters.labelSource)
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
    setLoading(true)
    try {
      const result = await api<ShippingReportData>(`/api/reports/sales/shipping?${baseParams}`, { signal: controller.signal })
      if (!controller.signal.aborted) {
        setData(result)
        onChannelsChange?.((result.channels || []).map((row) => String(row.channel || "")).filter(Boolean))
        setError("")
      }
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load shipping reporting.")
    } finally {
      if (summaryRequest.current === controller) { summaryRequest.current = null; setLoading(false) }
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

  useEffect(() => {
    if (!active) return
    setPage(1)
    void loadSummary()
    void loadRows(1, appliedQuery)
    return () => { summaryRequest.current?.abort(); rowsRequest.current?.abort() }
  }, [active, baseParams.toString(), pageSize])

  const summary = data.summary || {}
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const exportParams = new URLSearchParams(baseParams)
  if (appliedQuery) exportParams.set("q", appliedQuery)
  const filterOptions = (source: ReportRow[] | undefined, key: string) => [...new Set((source || []).map((row) => String(row[key] || "")).filter(Boolean))]
  const carrierOptions = filterOptions(data.carriers, "carrier")
  const serviceOptions = filterOptions(data.services, "service")
  const stateOptions = filterOptions(data.states, "destination_state")
  const labelSourceOptions = filterOptions(data.labelSources, "label_source")
  const billingStatusOptions = filterOptions(data.billingStatuses, "billing_status")
  const resetFilters = () => { setFilters(defaultFilters); setQuery(""); setAppliedQuery(""); setPage(1) }
  const applySearch = () => { setAppliedQuery(query.trim()); setPage(1); void loadRows(1, query.trim()) }

  return <div className="grid min-w-0 gap-5">
    <div className={`flex flex-wrap items-start gap-3 ${hideHeading ? "justify-end" : "justify-between"}`}>
      {!hideHeading ? <div><h2 className="text-lg font-semibold">Shipping report</h2><p className="text-sm text-muted-foreground">Carrier billing, package dimensions, rate variance, label activity, and shipping profitability.</p></div> : null}
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={loading || rowsLoading} onClick={() => { void loadSummary(); void loadRows(1) }}>{loading || rowsLoading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Refresh</Button></div>
    </div>

    <Card><CardContent className="flex flex-wrap items-end gap-2 p-4">
      <div className="grid gap-1"><Label className="text-xs">Date basis</Label><Select value={filters.dateBasis} onValueChange={(dateBasis) => setFilters((current) => ({ ...current, dateBasis }))}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="order">Order date</SelectItem><SelectItem value="activity">Label activity date</SelectItem><SelectItem value="shipped">Ship date</SelectItem></SelectContent></Select></div>
      <div className="grid gap-1"><Label className="text-xs">Carrier</Label><Select value={filters.carrier} onValueChange={(carrier) => setFilters((current) => ({ ...current, carrier, service: "all" }))}><SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All carriers</SelectItem>{carrierOptions.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid gap-1"><Label className="text-xs">Service</Label><Select value={filters.service} onValueChange={(service) => setFilters((current) => ({ ...current, service }))}><SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All services</SelectItem>{serviceOptions.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid gap-1"><Label className="text-xs">Destination</Label><Select value={filters.destinationState} onValueChange={(destinationState) => setFilters((current) => ({ ...current, destinationState }))}><SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All states</SelectItem>{stateOptions.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid gap-1"><Label className="text-xs">Cost basis</Label><Select value={filters.costBasis} onValueChange={(costBasis) => setFilters((current) => ({ ...current, costBasis }))}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All costs</SelectItem><SelectItem value="reconciled">Reconciled actual</SelectItem><SelectItem value="estimated">Purchased estimate</SelectItem><SelectItem value="missing">Missing cost</SelectItem><SelectItem value="adjusted">Later adjustment</SelectItem><SelectItem value="refunded">Refund / credit</SelectItem></SelectContent></Select></div>
      <div className="grid gap-1"><Label className="text-xs">Label source</Label><Select value={filters.labelSource} onValueChange={(labelSource) => setFilters((current) => ({ ...current, labelSource }))}><SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All sources</SelectItem>{labelSourceOptions.map((value) => <SelectItem key={value} value={value}>{label(value)}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid gap-1"><Label className="text-xs">Billing</Label><Select value={filters.billingStatus} onValueChange={(billingStatus) => setFilters((current) => ({ ...current, billingStatus }))}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All billing states</SelectItem>{billingStatusOptions.map((value) => <SelectItem key={value} value={value}>{label(value)}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid gap-1"><Label className="text-xs">Measurements</Label><Select value={filters.dimensionStatus} onValueChange={(dimensionStatus) => setFilters((current) => ({ ...current, dimensionStatus }))}><SelectTrigger className="h-9 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All measurements</SelectItem><SelectItem value="complete">Complete</SelectItem><SelectItem value="missing_weight">Missing weight</SelectItem><SelectItem value="missing_dimensions">Missing dimensions</SelectItem><SelectItem value="missing_all">Missing weight and dimensions</SelectItem></SelectContent></Select></div>
      <div className="grid gap-1"><Label className="text-xs">Billed variance</Label><Select value={filters.varianceStatus} onValueChange={(varianceStatus) => setFilters((current) => ({ ...current, varianceStatus }))}><SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All shipments</SelectItem><SelectItem value="billed">Has billed cost</SelectItem><SelectItem value="over">Billed higher</SelectItem><SelectItem value="under">Billed lower</SelectItem><SelectItem value="matching">Matches rate</SelectItem></SelectContent></Select></div>
      <label className="mb-2 flex items-center gap-2 text-sm"><Checkbox checked={filters.includeVoided} onCheckedChange={(checked) => setFilters((current) => ({ ...current, includeVoided: checked === true }))} />Include voided labels</label>
      <Button size="sm" variant="ghost" className="h-9" onClick={resetFilters}>Clear</Button>
    </CardContent></Card>

    {error ? <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Shipping report could not load</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    {loading && !data.generatedAt ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} className="h-24" />)}</div> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric title="Shipping expense" value={moneyLabel(summary.shipping_expense)} note={`${numberLabel(summary.shipment_count)} shipments`} />
        <Metric title="Purchased label rates" value={moneyLabel(summary.estimated_shipping_cost)} note={`${moneyLabel(summary.quoted_cost)} originally quoted`} />
        <Metric title="Carrier / channel billed" value={moneyLabel(summary.billed_shipping_cost)} note={`${percent(summary.billing_coverage)} billing coverage`} />
        <Metric title="Billed variance" value={moneyLabel(summary.billing_variance)} tone={amount(summary, "billing_variance") > 0 ? "text-destructive" : metricTone(amount(summary, "billing_variance"))} note={`${numberLabel(summary.overbilled_count)} higher | ${numberLabel(summary.underbilled_count)} lower`} />
        <Metric title="Package measurement coverage" value={percent(summary.package_coverage)} note={`${numberLabel(summary.missing_package_count)} need measurements`} />
        <Metric title="Customer shipping collected" value={moneyLabel(summary.customer_shipping_collected)} note="Revenue, not carrier expense" />
        <Metric title="Shipping contribution" value={moneyLabel(summary.shipping_contribution)} tone={metricTone(amount(summary, "shipping_contribution"))} note="Collected less effective expense" />
        <Metric title="Adjustments and credits" value={moneyLabel(amount(summary, "adjustments") - amount(summary, "refunded_cost"))} note={`${moneyLabel(summary.adjustments)} adjustments | ${moneyLabel(summary.refunded_cost)} credits`} />
      </div>
      {amount(summary, "reconciled_count") === 0 && amount(summary, "shipment_count") > 0 ? <Alert className="border-amber-500/40 bg-amber-500/10"><Info className="size-4" /><AlertTitle>Carrier invoices are not reconciled yet</AlertTitle><AlertDescription>Current shipping expense uses purchased label cost plus later adjustments, less recorded refunds. Actual carrier cost and variance will replace estimates as settlement lines are matched.</AlertDescription></Alert> : null}
      {amount(summary, "canceled_order_shipment_count") > 0 ? <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>{numberLabel(summary.canceled_order_shipment_count)} shipment records belong to canceled orders</AlertTitle><AlertDescription>These expenses remain visible because a purchased or shipped label can still cost money even when its sales order was canceled.</AlertDescription></Alert> : null}

      <Tabs value={tab} onValueChange={setTab} className="min-w-0">
        <div className="max-w-full overflow-x-auto rounded-md border bg-card p-1"><TabsList className="h-auto min-w-max justify-start bg-transparent p-0"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="costs">Carrier billing audit</TabsTrigger><TabsTrigger value="profitability">Shipping profitability</TabsTrigger><TabsTrigger value="shipments">Shipment ledger</TabsTrigger><TabsTrigger value="definitions">Metric notes</TabsTrigger></TabsList></div>
        <TabsContent value="overview" className="mt-5 grid gap-5 xl:grid-cols-2">
          <Card><CardHeader><CardTitle className="text-base">Shipping expense over time</CardTitle><CardDescription>Daily expense uses the selected date basis and excludes voided labels unless included above.</CardDescription></CardHeader><CardContent className="p-0"><EconomicsTable rows={data.daily || []} nameKey="date" nameLabel="Date" /></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Expense by channel</CardTitle><CardDescription>Order channel and label source remain separate dimensions.</CardDescription></CardHeader><CardContent className="p-0"><EconomicsTable rows={data.channels || []} nameKey="channel" nameLabel="Channel" /></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Destination states</CardTitle><CardDescription>Use shipping burden to find destinations where label expense consumes more revenue.</CardDescription></CardHeader><CardContent className="p-0"><EconomicsTable rows={data.states || []} nameKey="destination_state" nameLabel="State" /></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Cost completeness</CardTitle><CardDescription>Estimated costs come from label purchase. Reconciled costs come from a carrier or channel settlement.</CardDescription></CardHeader><CardContent className="p-0"><EconomicsTable rows={data.costBases || []} nameKey="cost_basis" nameLabel="Cost basis" /></CardContent></Card>
        </TabsContent>
        <TabsContent value="costs" className="mt-5 grid gap-5 xl:grid-cols-2">
          <Card><CardHeader><CardTitle className="text-base">Rates versus bills by carrier</CardTitle><CardDescription>Positive variance means the carrier or channel billed more than the net purchased label rate.</CardDescription></CardHeader><CardContent className="p-0"><RateAuditTable rows={data.carriers || []} nameKey="carrier" nameLabel="Carrier" /></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Rates versus bills by service</CardTitle><CardDescription>Use service-level variance to isolate repeated reweighs, dimensional corrections, and surcharges.</CardDescription></CardHeader><CardContent className="p-0"><RateAuditTable rows={data.services || []} nameKey="service" nameLabel="Service" /></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Rates versus bills by channel</CardTitle><CardDescription>Temu and other channel adjustments remain separate from the rate originally purchased.</CardDescription></CardHeader><CardContent className="p-0"><RateAuditTable rows={data.channels || []} nameKey="channel" nameLabel="Channel" /></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Billing evidence</CardTitle><CardDescription>Carrier invoice, channel adjustment, label purchase, quote-only, or missing evidence.</CardDescription></CardHeader><CardContent className="p-0"><RateAuditTable rows={data.billingBases || []} nameKey="billing_basis" nameLabel="Evidence" /></CardContent></Card>
          <Card className="xl:col-span-2"><CardHeader><CardTitle className="text-base">Package measurement quality</CardTitle><CardDescription>Missing weight or dimensions makes carrier re-rating and charge disputes difficult to verify.</CardDescription></CardHeader><CardContent className="p-0"><RateAuditTable rows={data.dimensionStatuses || []} nameKey="dimension_status" nameLabel="Measurement status" /></CardContent></Card>
        </TabsContent>
        <TabsContent value="profitability" className="mt-5 grid gap-5 xl:grid-cols-2">
          <Card><CardHeader><CardTitle className="text-base">Categories</CardTitle><CardDescription>Order shipping is allocated to lines by merchandise sales, then quantity, then evenly when neither is available.</CardDescription></CardHeader><CardContent className="p-0"><AllocationTable rows={data.categories || []} nameKey="category" nameLabel="Category" /></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Suppliers</CardTitle><CardDescription>Allocated shipping burden for merchandise sourced from each supplier.</CardDescription></CardHeader><CardContent className="p-0"><AllocationTable rows={data.suppliers || []} nameKey="supplier" nameLabel="Supplier" /></CardContent></Card>
          <Card className="xl:col-span-2"><CardHeader><CardTitle className="text-base">SKUs with the highest shipping expense</CardTitle><CardDescription>Use burden and contribution to identify products whose shipping economics need pricing or packaging review.</CardDescription></CardHeader><CardContent className="p-0"><AllocationTable rows={data.products || []} nameKey="sku" nameLabel="SKU / product" product /></CardContent></Card>
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
          <Card><CardHeader><CardTitle className="text-base">Financial definitions</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm text-muted-foreground"><p><strong className="text-foreground">Customer shipping collected</strong> is order revenue. It is never substituted for label or carrier expense.</p><p><strong className="text-foreground">Purchased label cost</strong> is the estimate captured when the label was bought. It remains visible after reconciliation.</p><p><strong className="text-foreground">Billed cost</strong> is backed by a matched carrier invoice or channel adjustment. <strong className="text-foreground">Billed variance</strong> is billed cost minus the net purchased label cost.</p><p><strong className="text-foreground">Effective shipping expense</strong> uses reconciled cost when available; otherwise it uses purchased cost less refunds plus recorded adjustments.</p><p><strong className="text-foreground">Shipping contribution</strong> is customer shipping collected less effective shipping expense. A negative value means merchandise margin is subsidizing shipping.</p></CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Measurements, allocation, and export</CardTitle></CardHeader><CardContent className="grid gap-3 text-sm text-muted-foreground"><p>Calculated dimensional weight uses entered package length x width x height divided by 139. Carrier-rated weight and dimensions remain separate invoice evidence.</p><p>Order-level shipping revenue and sales are divided across active shipment records so multi-label orders are not counted more than once.</p><p>Category, supplier, and SKU views allocate shipping economics by merchandise sales, then quantity, then evenly.</p><p>Package coverage is currently {percent(summary.package_coverage)}. Missing dimensions or weight remain visible and are never inferred.</p><p>Displayed columns and saved export templates are private to the signed-in user. Templates save columns, while the current dates and filters apply when the file is downloaded.</p><p>CSV exports are capped at 25,000 rows per request to protect the operational server.</p></CardContent></Card>
        </TabsContent>
      </Tabs>
      <p className="text-xs text-muted-foreground">Generated {dateLabel(data.generatedAt)}. The report follows the selected Sales period and channel. Carrier invoice reconciliation remains authoritative over label estimates when available.</p>
    </>}
  </div>
}
