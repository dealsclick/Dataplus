import { useEffect, useMemo, useState, type ReactNode } from "react"
import { Columns3, Download, Loader2, Save, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { api, dateLabel, moneyLabel, numberLabel } from "@/lib/client-api"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export type ShipmentRow = Record<string, string | number | boolean | null | undefined>

type ColumnDefinition = {
  id: string
  label: string
  group: string
  className?: string
  numeric?: boolean
  render: (row: ShipmentRow) => ReactNode
}

type ExportTemplate = { id: string; name: string; columns: string[]; updatedAt?: string }
type Preferences = { visibleColumns: string[]; exportTemplates: ExportTemplate[]; preferenceVersion?: number }

const SHIPPING_REPORT_PREFERENCE_VERSION = 2

const DEFAULT_VISIBLE_COLUMNS = [
  "order_number", "report_date", "channel", "skus", "destination", "carrier", "service", "tracking_number",
  "label_origin", "package_weight", "package_dimensions", "package_measurement_source", "calculated_dimensional_weight", "quoted_cost", "purchased_cost",
  "billed_cost", "billing_variance", "billing_basis",
]

const EXPORT_COLUMN_GROUPS = [
  { group: "Order", columns: [["report_date", "Report date"], ["order_number", "Order number"], ["internal_order", "Internal order"], ["marketplace_order", "Marketplace order"], ["customer", "Customer"], ["channel", "Channel"], ["order_status", "Order status"], ["shipment_id", "Shipment ID"], ["tracking_number", "Tracking number"], ["tracking_status", "Tracking status"]] },
  { group: "Items", columns: [["skus", "SKUs"], ["products", "Products"], ["suppliers", "Suppliers"], ["categories", "Categories"], ["units", "Units"]] },
  { group: "Carrier and destination", columns: [["destination", "Ship to"], ["destination_city", "Destination city"], ["destination_state", "Destination state"], ["destination_postal_code", "Destination postal code"], ["destination_country", "Destination country"], ["carrier", "Carrier"], ["service", "Service"], ["label_origin", "Purchased through"], ["provider", "Label provider"], ["carrier_zone", "Carrier zone"], ["carrier_package_type", "Carrier package type"]] },
  { group: "Label purchase measurements", columns: [["package_weight", "Label purchase weight"], ["package_dimensions", "Label purchase dimensions (combined)"], ["package_measurement_source", "Package dimensions source"], ["package_length", "Label purchase length"], ["package_width", "Label purchase width"], ["package_height", "Label purchase height"], ["calculated_dimensional_weight", "Purchase DIM weight (139)"], ["calculated_billable_weight", "Purchase billable weight"], ["dimension_status", "Purchase measurement status"]] },
  { group: "Carrier-reported measurements", columns: [["carrier_actual_weight", "Carrier-reported actual weight"], ["carrier_rated_weight", "Carrier-rated weight"], ["carrier_dimensional_weight", "Carrier-reported DIM weight"], ["carrier_billed_weight", "Carrier-billed weight"], ["carrier_billed_dimensions", "Carrier-reported dimensions (combined)"], ["carrier_billed_length", "Carrier-reported length"], ["carrier_billed_width", "Carrier-reported width"], ["carrier_billed_height", "Carrier-reported height"], ["carrier_weight_unit", "Carrier weight unit"], ["carrier_dimension_unit", "Carrier dimension unit"]] },
  { group: "Rates and billing", columns: [["customer_shipping", "Customer-paid shipping revenue"], ["quoted_cost", "Original quoted rate"], ["current_rate_cost", "Baseline label rate"], ["purchased_cost", "Purchased label amount"], ["net_purchased_cost", "Net purchased label cost"], ["refund_credit", "Label refund or void credit"], ["adjustment", "Recorded shipping adjustment"], ["recorded_actual_cost", "Reconciled shipment cost"], ["matched_settlement_charges", "Matched settlement shipping charges"], ["billed_cost", "Final billed shipping cost"], ["effective_cost", "Shipping expense used in P&L"], ["billing_variance", "Final cost variance"], ["billing_variance_percent", "Final cost variance percent"], ["shipping_contribution", "Shipping revenue less expense"], ["cost_basis", "Cost basis"], ["billing_basis", "Cost evidence"], ["billing_status", "Billing status"]] },
  { group: "Recorded adjustment evidence", columns: [["adjustment_count", "Adjustment count"], ["adjustment_types", "Adjustment types"], ["adjustment_references", "Adjustment references"], ["adjustment_sources", "Adjustment sources"], ["adjustment_reasons", "Adjustment reasons"], ["last_adjustment_at", "Last adjustment date"]] },
  { group: "Settlement evidence", columns: [["settlement_id", "Settlement ID"], ["settlement_issued_at", "Settlement issued at"], ["settlement_period_start", "Settlement period start"], ["settlement_period_end", "Settlement period end"], ["settlement_source_file", "Settlement source file"], ["settlement_api_reference", "Settlement API reference"], ["carrier_invoice", "Carrier invoice"], ["carrier_invoice_line", "Carrier invoice line"], ["settlement_fee_types", "Carrier charge types"], ["settlement_descriptions", "Carrier charge descriptions"]] },
  { group: "Operations and audit", columns: [["batch_id", "Batch ID"], ["print_job_id", "Print job ID"], ["shipment_group", "Shipment group"], ["shared_label", "Shared label"], ["warehouse", "Warehouse"], ["purchased_at", "Purchased at"], ["shipped_at", "Shipped at"], ["billed_at", "Billed at"], ["reconciled_at", "Reconciled at"], ["reconciled_by", "Reconciled by"], ["void_status", "Void status"], ["label_source", "Technical source code"]] },
] as const

const EXPORT_COLUMNS = EXPORT_COLUMN_GROUPS.flatMap((section) => section.columns.map(([id, label]) => ({ id, label, group: section.group })))
const EXPORT_COLUMN_IDS = new Set(EXPORT_COLUMNS.map((column) => column.id))

function text(value: unknown, fallback = "-") { return String(value || fallback) }
function optionalMoney(value: unknown) { return value === null || value === undefined || value === "" ? "-" : moneyLabel(value) }
function optionalNumber(value: unknown, digits = 2) { return value === null || value === undefined || value === "" ? "-" : Number(value).toFixed(digits) }
function percentValue(value: unknown) { return value === null || value === undefined || value === "" ? "-" : `${(Number(value) * 100).toFixed(1)}%` }
function dimensions(row: ShipmentRow, prefix = "package") {
  const values = [row[`${prefix}_length`], row[`${prefix}_width`], row[`${prefix}_height`]]
  const unit = prefix === "carrier_billed" ? text(row.carrier_dimension_unit, "in") : "in"
  return values.every((value) => Number(value || 0) > 0) ? `${values.map((value) => Number(value).toFixed(1)).join(" x ")} ${unit}` : "-"
}
function statusLabel(value: unknown) { return text(value, "Unknown").replaceAll("_", " ") }
function friendlySourceName(value: unknown) {
  const source = String(value || "").trim()
  const normalized = source.toLowerCase()
  if (normalized === "ebay") return "eBay"
  if (normalized === "temu") return "Temu"
  if (normalized === "walmart") return "Walmart"
  if (normalized === "shopify") return "Shopify"
  if (normalized === "veeqo" || normalized === "veeqo allocation") return "Veeqo"
  return source ? statusLabel(source) : "Unknown"
}
function labelPurchaseWorkflow(row: ShipmentRow) {
  const source = String(row.label_source || "").trim().toLowerCase()
  const provider = String(row.provider || "").trim().toLowerCase()
  const localSources = ["dataplus", "data plus", "local", "veeqo", "veeqo allocation", "rate shopping"]
  const externalSources = ["ebay", "temu", "walmart", "shopify", "outsourced", "marketplace", "channel import", "channel_import", "imported", "shipment history", "shipment_history"]
  if (String(row.batch_id || "").trim() || String(row.print_job_id || "").trim() || localSources.includes(source)) return "DataPlus"
  if (externalSources.includes(source) || ["ebay", "temu", "walmart", "shopify"].includes(provider)) return "Outside DataPlus"
  return "Unknown"
}
function labelProvider(row: ShipmentRow) {
  const provider = String(row.provider || "").trim()
  if (provider && !["dataplus", "data plus", "local", "rate shopping"].includes(provider.toLowerCase())) return friendlySourceName(provider)
  const source = String(row.label_source || "").trim().toLowerCase()
  if (source && !["dataplus", "data plus", "local", "outsourced", "rate shopping", "unknown", "legacy_unknown"].includes(source)) return friendlySourceName(source)
  if (source === "outsourced") return friendlySourceName(row.report_channel || row.channel_source)
  return "Unknown"
}
function packageMeasurementOrigin(row: ShipmentRow) {
  const source = String(row.package_measurement_source || "").trim().toLowerCase()
  if (!source || source === "legacy_unknown") return "Historical - unknown"
  if (source === "missing" || source.includes("incomplete")) return "No complete dimensions"
  if (source === "channel_import" || source.includes("import") || source.includes("marketplace") || source.includes("shipment_history")) {
    const channel = String(row.report_channel || row.channel_source || row.label_source || "source").trim()
    return `Imported - ${friendlySourceName(channel)}`
  }
  if (source === "dataplus_manual" || source === "manual") return "DataPlus - manual"
  if (source === "dataplus_rate_request" || source.includes("rate")) return "DataPlus - rate request"
  if (source === "dataplus_saved_package") return "DataPlus - saved package"
  if (source.startsWith("dataplus_") || source.includes("product") || source.includes("order_package") || source.includes("inferred") || source.includes("combined") || source.includes("weight_based") || source.includes("shadow_pack")) return "DataPlus - fulfillment"
  return "Historical - unknown"
}

const DISPLAY_COLUMNS: ColumnDefinition[] = [
  { id: "order_number", label: "Order", group: "Order", className: "min-w-32", render: (row) => <a className="font-medium text-primary hover:underline" href={`/orders/${encodeURIComponent(text(row.order_id, ""))}`}>{text(row.display_order_number, "Order")}</a> },
  { id: "report_date", label: "Date", group: "Order", className: "min-w-32", render: (row) => dateLabel(text(row.report_date, "")) },
  { id: "internal_order", label: "Internal order", group: "Order", render: (row) => text(row.internal_order_number) },
  { id: "marketplace_order", label: "Marketplace order", group: "Order", render: (row) => text(row.marketplace_order_id) },
  { id: "customer", label: "Customer", group: "Order", render: (row) => text(row.buyer) },
  { id: "channel", label: "Channel", group: "Order", render: (row) => text(row.report_channel) },
  { id: "order_status", label: "Order status", group: "Order", render: (row) => <Badge variant={["canceled", "cancelled", "void", "voided"].includes(text(row.order_status, "").toLowerCase()) ? "destructive" : "outline"}>{statusLabel(row.order_status)}</Badge> },
  { id: "shipment_id", label: "Shipment ID", group: "Order", className: "min-w-36", render: (row) => text(row.shipment_id) },
  { id: "tracking_number", label: "Tracking", group: "Order", className: "min-w-44", render: (row) => <span className="block max-w-52 truncate" title={text(row.tracking_number, "")}>{text(row.tracking_number, "No tracking")}</span> },
  { id: "tracking_status", label: "Tracking status", group: "Order", render: (row) => statusLabel(row.tracking_status) },
  { id: "skus", label: "SKUs", group: "Items", className: "min-w-44", render: (row) => <span className="block max-w-64 truncate font-medium" title={text(row.skus, "")}>{text(row.skus, "No SKU")}</span> },
  { id: "products", label: "Products", group: "Items", className: "min-w-56", render: (row) => <span className="block max-w-72 truncate" title={text(row.titles, "")}>{text(row.titles, "No title")}</span> },
  { id: "suppliers", label: "Suppliers", group: "Items", render: (row) => text(row.suppliers) },
  { id: "categories", label: "Categories", group: "Items", render: (row) => text(row.categories) },
  { id: "units", label: "Units", group: "Items", numeric: true, render: (row) => numberLabel(row.units) },
  { id: "destination", label: "Ship to", group: "Carrier and destination", className: "min-w-36", render: (row) => [row.destination_city, row.destination_state].filter(Boolean).join(", ") || "Unknown" },
  { id: "destination_city", label: "Destination city", group: "Carrier and destination", render: (row) => text(row.destination_city) },
  { id: "destination_state", label: "Destination state", group: "Carrier and destination", render: (row) => text(row.destination_state) },
  { id: "destination_postal_code", label: "Destination postal code", group: "Carrier and destination", render: (row) => text(row.destination_postal_code) },
  { id: "destination_country", label: "Destination country", group: "Carrier and destination", render: (row) => text(row.destination_country) },
  { id: "carrier", label: "Carrier", group: "Carrier and destination", render: (row) => text(row.carrier) },
  { id: "service", label: "Service", group: "Carrier and destination", className: "min-w-40", render: (row) => text(row.service) },
  { id: "label_origin", label: "Purchased through", group: "Carrier and destination", render: (row) => { const workflow = labelPurchaseWorkflow(row); return <Badge title="Where the label purchase or retrieval was initiated" variant={workflow === "DataPlus" ? "success" : workflow === "Outside DataPlus" ? "secondary" : "warning"}>{workflow}</Badge> } },
  { id: "provider", label: "Label provider", group: "Carrier and destination", render: (row) => labelProvider(row) },
  { id: "label_source", label: "Technical source code", group: "Operations and audit", render: (row) => statusLabel(row.label_source) },
  { id: "carrier_zone", label: "Zone", group: "Carrier and destination", render: (row) => text(row.carrier_zone) },
  { id: "carrier_package_type", label: "Carrier package type", group: "Carrier and destination", render: (row) => text(row.carrier_package_type) },
  { id: "package_weight", label: "Label purchase weight", group: "Label purchase measurements", numeric: true, render: (row) => row.package_weight ? `${optionalNumber(row.package_weight)} lb` : "-" },
  { id: "package_dimensions", label: "Label purchase dimensions", group: "Label purchase measurements", className: "min-w-44", render: (row) => dimensions(row) },
  { id: "package_measurement_source", label: "Package dims source", group: "Label purchase measurements", className: "min-w-44", render: (row) => { const origin = packageMeasurementOrigin(row); return <Badge title={`Stored source: ${text(row.package_measurement_source, "unknown")}`} variant={origin.startsWith("DataPlus") ? "success" : origin.startsWith("Imported") ? "secondary" : origin.startsWith("No complete") ? "destructive" : "warning"}>{origin}</Badge> } },
  { id: "calculated_dimensional_weight", label: "Purchase DIM weight", group: "Label purchase measurements", numeric: true, render: (row) => row.calculated_dimensional_weight ? `${optionalNumber(row.calculated_dimensional_weight)} lb` : "-" },
  { id: "calculated_billable_weight", label: "Purchase billable weight", group: "Label purchase measurements", numeric: true, render: (row) => row.calculated_billable_weight ? `${optionalNumber(row.calculated_billable_weight)} lb` : "-" },
  { id: "dimension_status", label: "Purchase measurement status", group: "Label purchase measurements", render: (row) => <Badge variant={row.dimension_status === "complete" ? "success" : "warning"}>{statusLabel(row.dimension_status)}</Badge> },
  { id: "carrier_actual_weight", label: "Carrier-reported actual weight", group: "Carrier-reported measurements", numeric: true, render: (row) => `${optionalNumber(row.carrier_actual_weight)}${row.carrier_actual_weight == null ? "" : ` ${text(row.carrier_weight_unit, "lb")}`}` },
  { id: "carrier_rated_weight", label: "Carrier-rated weight", group: "Carrier-reported measurements", numeric: true, render: (row) => `${optionalNumber(row.carrier_rated_weight)}${row.carrier_rated_weight == null ? "" : ` ${text(row.carrier_weight_unit, "lb")}`}` },
  { id: "carrier_dimensional_weight", label: "Carrier-reported DIM weight", group: "Carrier-reported measurements", numeric: true, render: (row) => `${optionalNumber(row.carrier_dimensional_weight)}${row.carrier_dimensional_weight == null ? "" : ` ${text(row.carrier_weight_unit, "lb")}`}` },
  { id: "carrier_billed_weight", label: "Carrier-billed weight", group: "Carrier-reported measurements", numeric: true, render: (row) => `${optionalNumber(row.carrier_billed_weight)}${row.carrier_billed_weight == null ? "" : ` ${text(row.carrier_weight_unit, "lb")}`}` },
  { id: "carrier_billed_dimensions", label: "Carrier-reported dimensions", group: "Carrier-reported measurements", className: "min-w-44", render: (row) => dimensions(row, "carrier_billed") },
  { id: "carrier_weight_unit", label: "Carrier weight unit", group: "Carrier-reported measurements", render: (row) => text(row.carrier_weight_unit) },
  { id: "carrier_dimension_unit", label: "Carrier dimension unit", group: "Carrier-reported measurements", render: (row) => text(row.carrier_dimension_unit) },
  { id: "customer_shipping", label: "Customer-paid shipping revenue", group: "Rates and billing", numeric: true, render: (row) => optionalMoney(row.allocated_shipping_revenue) },
  { id: "quoted_cost", label: "Original quoted rate", group: "Rates and billing", numeric: true, render: (row) => optionalMoney(row.quoted_cost) },
  { id: "current_rate_cost", label: "Baseline label rate", group: "Rates and billing", numeric: true, render: (row) => optionalMoney(row.current_rate_cost) },
  { id: "purchased_cost", label: "Purchased label amount", group: "Rates and billing", numeric: true, render: (row) => optionalMoney(row.estimated_shipping_cost) },
  { id: "net_purchased_cost", label: "Net purchased label cost", group: "Rates and billing", numeric: true, render: (row) => optionalMoney(row.net_estimated_cost) },
  { id: "refund_credit", label: "Label refund / void credit", group: "Rates and billing", numeric: true, render: (row) => optionalMoney(row.refunded_cost) },
  { id: "adjustment", label: "Recorded shipping adjustment", group: "Rates and billing", numeric: true, render: (row) => optionalMoney(row.allocated_adjustment) },
  { id: "recorded_actual_cost", label: "Reconciled shipment cost", group: "Rates and billing", numeric: true, render: (row) => optionalMoney(row.actual_shipping_cost) },
  { id: "matched_settlement_charges", label: "Matched settlement shipping charges", group: "Rates and billing", numeric: true, render: (row) => optionalMoney(row.settlement_line_total) },
  { id: "billed_cost", label: "Final billed shipping cost", group: "Rates and billing", numeric: true, render: (row) => optionalMoney(row.billed_shipping_cost) },
  { id: "effective_cost", label: "Shipping expense used in P&L", group: "Rates and billing", numeric: true, render: (row) => optionalMoney(row.effective_shipping_cost) },
  { id: "billing_variance", label: "Final cost variance", group: "Rates and billing", numeric: true, render: (row) => <span className={Number(row.reconciliation_variance || 0) > 0 ? "font-medium text-destructive" : Number(row.reconciliation_variance || 0) < 0 ? "font-medium text-emerald-600" : ""}>{optionalMoney(row.reconciliation_variance)}</span> },
  { id: "billing_variance_percent", label: "Final cost variance %", group: "Rates and billing", numeric: true, render: (row) => Number(row.net_estimated_cost || 0) > 0 && row.reconciliation_variance != null ? percentValue(Number(row.reconciliation_variance) / Number(row.net_estimated_cost)) : "-" },
  { id: "cost_basis", label: "Cost basis", group: "Rates and billing", render: (row) => <Badge variant={row.cost_basis === "reconciled" ? "success" : row.cost_basis === "missing" ? "destructive" : "warning"}>{statusLabel(row.cost_basis)}</Badge> },
  { id: "billing_basis", label: "Cost evidence", group: "Rates and billing", render: (row) => <Badge variant={["carrier_invoice", "matched_settlement"].includes(text(row.billing_basis, "")) ? "success" : row.billing_basis === "recorded_adjustment" ? "warning" : "outline"}>{statusLabel(row.billing_basis)}</Badge> },
  { id: "billing_status", label: "Billing status", group: "Rates and billing", render: (row) => statusLabel(row.billing_status) },
  { id: "shipping_contribution", label: "Shipping revenue less expense", group: "Rates and billing", numeric: true, render: (row) => optionalMoney(Number(row.allocated_shipping_revenue || 0) - Number(row.effective_shipping_cost || 0)) },
  { id: "adjustment_count", label: "Adjustment count", group: "Evidence", numeric: true, render: (row) => numberLabel(row.adjustment_count) },
  { id: "adjustment_types", label: "Adjustment types", group: "Evidence", render: (row) => text(row.adjustment_types) },
  { id: "adjustment_references", label: "Adjustment reference", group: "Evidence", className: "min-w-44", render: (row) => <span className="block max-w-64 truncate" title={text(row.adjustment_references, "")}>{text(row.adjustment_references)}</span> },
  { id: "adjustment_sources", label: "Adjustment sources", group: "Evidence", render: (row) => text(row.adjustment_sources) },
  { id: "adjustment_reasons", label: "Adjustment reason", group: "Evidence", className: "min-w-48", render: (row) => <span className="block max-w-72 truncate" title={text(row.adjustment_reasons, "")}>{text(row.adjustment_reasons)}</span> },
  { id: "last_adjustment_at", label: "Last adjustment", group: "Evidence", render: (row) => dateLabel(text(row.last_adjustment_at, "")) },
  { id: "settlement_id", label: "Settlement", group: "Evidence", render: (row) => text(row.report_settlement_id || row.settlement_id) },
  { id: "settlement_issued_at", label: "Settlement issued", group: "Evidence", render: (row) => dateLabel(text(row.settlement_issued_at, "")) },
  { id: "settlement_period_start", label: "Settlement period start", group: "Evidence", render: (row) => dateLabel(text(row.settlement_period_start, "")) },
  { id: "settlement_period_end", label: "Settlement period end", group: "Evidence", render: (row) => dateLabel(text(row.settlement_period_end, "")) },
  { id: "settlement_source_file", label: "Settlement source file", group: "Evidence", render: (row) => text(row.settlement_source_file) },
  { id: "settlement_api_reference", label: "Settlement API reference", group: "Evidence", render: (row) => text(row.settlement_api_reference) },
  { id: "carrier_invoice", label: "Carrier invoice", group: "Evidence", render: (row) => text(row.carrier_invoice_number) },
  { id: "carrier_invoice_line", label: "Carrier invoice line", group: "Evidence", render: (row) => text(row.carrier_invoice_line_id) },
  { id: "settlement_fee_types", label: "Charge types", group: "Evidence", render: (row) => text(row.settlement_fee_types) },
  { id: "settlement_descriptions", label: "Charge descriptions", group: "Evidence", render: (row) => text(row.settlement_descriptions) },
  { id: "batch_id", label: "Batch", group: "Evidence", render: (row) => text(row.batch_id) },
  { id: "print_job_id", label: "Print job", group: "Evidence", render: (row) => text(row.print_job_id) },
  { id: "shipment_group", label: "Shipment group", group: "Evidence", render: (row) => text(row.shipment_group_id) },
  { id: "shared_label", label: "Shared label", group: "Evidence", render: (row) => row.shared_label ? "Yes" : "No" },
  { id: "warehouse", label: "Warehouse", group: "Evidence", render: (row) => text(row.warehouse_id) },
  { id: "purchased_at", label: "Purchased at", group: "Evidence", render: (row) => dateLabel(text(row.purchased_at, "")) },
  { id: "shipped_at", label: "Shipped at", group: "Evidence", render: (row) => dateLabel(text(row.shipped_at, "")) },
  { id: "billed_at", label: "Billed at", group: "Evidence", render: (row) => dateLabel(text(row.billed_at, "")) },
  { id: "reconciled_at", label: "Reconciled at", group: "Evidence", render: (row) => dateLabel(text(row.reconciled_at, "")) },
  { id: "reconciled_by", label: "Reconciled by", group: "Evidence", render: (row) => text(row.reconciled_by) },
  { id: "void_status", label: "Void status", group: "Evidence", render: (row) => statusLabel(row.void_status) },
]

const DISPLAY_COLUMN_IDS = new Set(DISPLAY_COLUMNS.map((column) => column.id))

function uniqueValidColumns(columns: string[], allowed: Set<string>, fallback: string[]) {
  const result = [...new Set(columns.map((column) => String(column || "").trim()).filter((column) => allowed.has(column)))]
  return result.length ? result : [...fallback]
}

function migrateDisplayColumns(columns: string[], preferenceVersion = 0) {
  const migrated = [...columns]
  if (preferenceVersion < 1) {
    for (let index = 0; index < migrated.length; index += 1) {
      if (migrated[index] === "label_source") migrated[index] = "label_origin"
    }
    if (!migrated.includes("label_origin")) {
      const trackingIndex = migrated.indexOf("tracking_number")
      migrated.splice(trackingIndex >= 0 ? trackingIndex + 1 : migrated.length, 0, "label_origin")
    }
  }
  if (preferenceVersion < 2 && !migrated.includes("package_measurement_source")) {
    const dimensionsIndex = migrated.indexOf("package_dimensions")
    migrated.splice(dimensionsIndex >= 0 ? dimensionsIndex + 1 : migrated.length, 0, "package_measurement_source")
  }
  return migrated
}

export function ShippingReportLedger({
  rows, loading, total, page, totalPages, pageSize, query, exportParams,
  onQueryChange, onSearch, onPageChange, onPageSizeChange,
}: {
  rows: ShipmentRow[]
  loading: boolean
  total: number
  page: number
  totalPages: number
  pageSize: number
  query: string
  exportParams: URLSearchParams
  onQueryChange: (value: string) => void
  onSearch: () => void
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}) {
  const [visibleColumns, setVisibleColumns] = useState<string[]>(DEFAULT_VISIBLE_COLUMNS)
  const [templates, setTemplates] = useState<ExportTemplate[]>([])
  const [preferencesLoaded, setPreferencesLoaded] = useState(false)
  const [savingPreferences, setSavingPreferences] = useState(false)
  const [columnPickerOpen, setColumnPickerOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportColumns, setExportColumns] = useState<string[]>(DEFAULT_VISIBLE_COLUMNS)
  const [templateName, setTemplateName] = useState("")
  const [selectedTemplateId, setSelectedTemplateId] = useState("")
  const [exportQueuing, setExportQueuing] = useState(false)

  useEffect(() => {
    let live = true
    void api<Preferences>("/api/reports/sales/shipping/preferences").then((preferences) => {
      if (!live) return
      const nextVisible = uniqueValidColumns(migrateDisplayColumns(preferences.visibleColumns || [], Number(preferences.preferenceVersion || 0)), DISPLAY_COLUMN_IDS, DEFAULT_VISIBLE_COLUMNS)
      const nextTemplates = Array.isArray(preferences.exportTemplates) ? preferences.exportTemplates : []
      setVisibleColumns(nextVisible)
      setTemplates(nextTemplates)
      setExportColumns(nextVisible)
    }).catch(() => {}).finally(() => { if (live) setPreferencesLoaded(true) })
    return () => { live = false }
  }, [])

  async function persist(nextVisible = visibleColumns, nextTemplates = templates, successMessage = "") {
    if (!preferencesLoaded) return
    setSavingPreferences(true)
    try {
      const saved = await api<Preferences>("/api/reports/sales/shipping/preferences", { method: "PUT", body: JSON.stringify({ visibleColumns: nextVisible, exportTemplates: nextTemplates, preferenceVersion: SHIPPING_REPORT_PREFERENCE_VERSION }) })
      setVisibleColumns(uniqueValidColumns(migrateDisplayColumns(saved.visibleColumns || [], Number(saved.preferenceVersion || 0)), DISPLAY_COLUMN_IDS, DEFAULT_VISIBLE_COLUMNS))
      setTemplates(saved.exportTemplates || [])
      if (successMessage) toast.success(successMessage)
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Unable to save shipping report preferences.")
    } finally {
      setSavingPreferences(false)
    }
  }

  const selectedDisplayColumns = useMemo(() => visibleColumns.map((id) => DISPLAY_COLUMNS.find((column) => column.id === id)).filter((column): column is ColumnDefinition => Boolean(column)), [visibleColumns])
  const displayGroups = useMemo(() => [...new Set(DISPLAY_COLUMNS.map((column) => column.group))], [])

  function toggleVisible(id: string, checked: boolean) {
    setVisibleColumns((current) => checked ? [...current, id] : current.length > 1 ? current.filter((column) => column !== id) : current)
  }

  function openExport() {
    setExportColumns(uniqueValidColumns(visibleColumns, EXPORT_COLUMN_IDS, DEFAULT_VISIBLE_COLUMNS))
    setSelectedTemplateId("")
    setTemplateName("")
    setExportOpen(true)
  }

  function applyTemplate(id: string) {
    setSelectedTemplateId(id)
    const template = templates.find((candidate) => candidate.id === id)
    if (template) {
      setExportColumns(uniqueValidColumns(template.columns || [], EXPORT_COLUMN_IDS, DEFAULT_VISIBLE_COLUMNS))
      setTemplateName(template.name)
    }
  }

  async function saveTemplate() {
    const name = templateName.trim()
    if (!name) { toast.error("Enter a template name."); return }
    if (!exportColumns.length) { toast.error("Choose at least one export column."); return }
    const existing = templates.find((template) => template.id === selectedTemplateId)
    const template: ExportTemplate = { id: existing?.id || crypto.randomUUID(), name, columns: exportColumns, updatedAt: new Date().toISOString() }
    const nextTemplates = existing ? templates.map((candidate) => candidate.id === existing.id ? template : candidate) : [...templates, template]
    setTemplates(nextTemplates)
    setSelectedTemplateId(template.id)
    await persist(visibleColumns, nextTemplates, `Export template ${name} saved.`)
  }

  async function deleteTemplate() {
    if (!selectedTemplateId) return
    const nextTemplates = templates.filter((template) => template.id !== selectedTemplateId)
    setTemplates(nextTemplates)
    setSelectedTemplateId("")
    setTemplateName("")
    await persist(visibleColumns, nextTemplates, "Export template deleted.")
  }

  async function downloadExport() {
    if (!exportColumns.length) { toast.error("Choose at least one export column."); return }
    setExportQueuing(true)
    try {
      const result = await api<{ message?: string; job?: { id?: string; jobNumber?: string | number } }>("/api/reports/sales/shipping/exports", {
        method: "POST",
        body: JSON.stringify({
          filters: Object.fromEntries(exportParams.entries()),
          columns: exportColumns,
          templateName: templates.find((template) => template.id === selectedTemplateId)?.name || templateName.trim(),
        }),
      })
      setExportOpen(false)
      toast.success(result.message || "Shipping Report export queued.", {
        action: result.job?.id ? { label: "View job", onClick: () => { window.location.href = `/jobs/${encodeURIComponent(String(result.job?.id || ""))}` } } : undefined,
      })
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : "Unable to queue Shipping Report export.")
    } finally {
      setExportQueuing(false)
    }
  }

  return <>
    <Card>
      <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
        <div><CardTitle className="text-base">Shipment and carrier audit ledger</CardTitle><CardDescription>Compare label purchase measurements and costs with carrier-reported measurements, recorded adjustments, and final billed cost.</CardDescription></div>
        <div className="flex flex-wrap gap-2">
          <div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="h-9 w-72 max-w-[62vw] pl-9" placeholder="Order, tracking, customer, SKU" value={query} onChange={(event) => onQueryChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSearch() }} /></div>
          <Button size="sm" className="h-9" onClick={onSearch}>Search</Button>
          <Popover open={columnPickerOpen} onOpenChange={(open) => { setColumnPickerOpen(open); if (!open) void persist() }}>
            <PopoverTrigger asChild><Button size="sm" variant="outline" className="h-9"><Columns3 className="size-4" /> Columns ({selectedDisplayColumns.length})</Button></PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0"><PopoverHeader className="border-b p-3"><PopoverTitle>Displayed columns</PopoverTitle><p className="text-xs text-muted-foreground">Your layout is saved when this menu closes.</p></PopoverHeader><ScrollArea className="h-80"><div className="grid gap-4 p-3">{displayGroups.map((group) => <div key={group} className="grid gap-2"><p className="text-xs font-semibold text-muted-foreground">{group}</p>{DISPLAY_COLUMNS.filter((column) => column.group === group).map((column) => <label key={column.id} className="flex items-center gap-2 text-sm"><Checkbox checked={visibleColumns.includes(column.id)} onCheckedChange={(checked) => toggleVisible(column.id, checked === true)} />{column.label}</label>)}</div>)}</div></ScrollArea><div className="flex items-center justify-between border-t p-2"><Button size="sm" variant="ghost" onClick={() => setVisibleColumns(DEFAULT_VISIBLE_COLUMNS)}>Reset</Button><span className="text-xs text-muted-foreground">{savingPreferences ? "Saving..." : "Saved per user"}</span></div></PopoverContent>
          </Popover>
          <Button size="sm" variant="outline" className="h-9" onClick={openExport}><Download className="size-4" /> Export</Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto"><Table><TableHeader><TableRow>{selectedDisplayColumns.map((column) => <TableHead key={column.id} className={`${column.className || ""} ${column.numeric ? "text-right" : ""}`}>{column.label}</TableHead>)}</TableRow></TableHeader><TableBody>{loading ? Array.from({ length: 5 }, (_, index) => <TableRow key={index}><TableCell colSpan={selectedDisplayColumns.length}><Skeleton className="h-10" /></TableCell></TableRow>) : rows.map((row) => <TableRow key={`${text(row.order_id, "")}-${text(row.shipment_id, "")}`}>{selectedDisplayColumns.map((column) => <TableCell key={column.id} className={`${column.className || ""} ${column.numeric ? "text-right" : ""}`}>{column.render(row)}</TableCell>)}</TableRow>)}{!loading && !rows.length && <TableRow><TableCell colSpan={selectedDisplayColumns.length} className="h-28 text-center text-muted-foreground">No shipment records match the current filters.</TableCell></TableRow>}</TableBody></Table></div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-sm text-muted-foreground"><span>{numberLabel(total)} shipments | Page {page} of {totalPages}</span><div className="flex items-center gap-2"><Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}><SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="25">25</SelectItem><SelectItem value="50">50</SelectItem><SelectItem value="100">100</SelectItem></SelectContent></Select><Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => onPageChange(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={page >= totalPages || loading} onClick={() => onPageChange(page + 1)}>Next</Button></div></div>
      </CardContent>
    </Card>

    <Dialog open={exportOpen} onOpenChange={setExportOpen}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-hidden p-0">
        <DialogHeader className="border-b p-4 pr-12"><DialogTitle>Export shipping audit</DialogTitle><DialogDescription>Choose exactly which fields accounting needs. The export runs in the background, so long date ranges remain reliable and the completed CSV can be downloaded from Jobs.</DialogDescription></DialogHeader>
        <div className="grid min-h-0 gap-4 px-4 md:grid-cols-[260px_minmax(0,1fr)]">
          <div className="grid content-start gap-3 border-b pb-4 md:border-b-0 md:border-r md:pr-4">
            <Label>Saved template</Label>
            <Select value={selectedTemplateId || "new"} onValueChange={(value) => value === "new" ? (setSelectedTemplateId(""), setTemplateName(""), setExportColumns(visibleColumns)) : applyTemplate(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new">New export template</SelectItem>{templates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent></Select>
            <Label htmlFor="shipping-export-template-name">Template name</Label><Input id="shipping-export-template-name" value={templateName} onChange={(event) => setTemplateName(event.target.value)} placeholder="Temu carrier audit" maxLength={80} />
            <div className="flex gap-2"><Button size="sm" onClick={() => void saveTemplate()} disabled={savingPreferences}><Save className="size-4" /> Save</Button>{selectedTemplateId ? <Button size="sm" variant="outline" onClick={() => void deleteTemplate()} disabled={savingPreferences}><Trash2 className="size-4" /> Delete</Button> : null}</div>
            <Separator />
            <Button size="sm" variant="outline" onClick={() => setExportColumns(EXPORT_COLUMNS.map((column) => column.id))}>Select all columns</Button>
            <Button size="sm" variant="ghost" onClick={() => setExportColumns(visibleColumns)}>Use displayed columns</Button>
            <p className="text-xs text-muted-foreground">{exportColumns.length} of {EXPORT_COLUMNS.length} columns selected. Current report filters will be applied at download time.</p>
          </div>
          <ScrollArea className="h-[52vh] min-h-80"><div className="grid gap-5 pb-4 pr-4 md:grid-cols-2">{EXPORT_COLUMN_GROUPS.map((section) => <div key={section.group} className="grid content-start gap-2"><p className="text-sm font-semibold">{section.group}</p>{section.columns.map(([id, columnLabel]) => <label key={id} className="flex items-start gap-2 text-sm"><Checkbox className="mt-0.5" checked={exportColumns.includes(id)} onCheckedChange={(checked) => setExportColumns((current) => checked === true ? [...current, id] : current.filter((column) => column !== id))} /><span>{columnLabel}</span></label>)}</div>)}</div></ScrollArea>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setExportOpen(false)} disabled={exportQueuing}>Cancel</Button><Button onClick={() => void downloadExport()} disabled={!exportColumns.length || exportQueuing}>{exportQueuing ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} {exportQueuing ? "Queueing export" : `Export ${exportColumns.length} columns`}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
