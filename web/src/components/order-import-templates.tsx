import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'

const templates = [
  {
    name: 'Standard order lines', file: 'standard-order-lines.csv',
    description: 'Enter quantity, unit selling price, and company-specific unit cost. DataPlus calculates extended sales and cost.',
    headers: ['order_id', 'line_id', 'order_date', 'sku', 'quantity', 'unit_price', 'unit_cost', 'customer', 'status'],
  },
  {
    name: 'Historical sales details', file: 'historical-sales-details.csv',
    description: 'Import extended line sales and costs from an outside system, with customer, supplier, and reference details.',
    headers: ['order_id', 'line_id', 'order_date', 'sku', 'quantity', 'line_total', 'line_cost', 'customer', 'reference', 'status', 'description', 'vendor', 'uom'],
  },
]

function downloadTemplate(headers: string[], filename: string) {
  const url = URL.createObjectURL(new Blob([headers.join(',') + '\r\n'], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = filename
  document.body.appendChild(link); link.click(); link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function OrderImportTemplates() {
  return <section className="space-y-4" aria-label="Order import templates">
    <div><h2 className="text-lg font-semibold">Order import templates</h2><p className="text-sm text-muted-foreground">Download a blank CSV, fill in your order lines, then open Import orders and select the destination company. Both templates work for LINQ USA and BuySupply.</p></div>
    <div className="grid gap-4 lg:grid-cols-2">{templates.map(template => <article key={template.file} className="min-w-0 space-y-3 rounded-lg border bg-background p-4">
      <h3 className="font-medium">{template.name}</h3><p className="text-sm text-muted-foreground">{template.description}</p>
      <Button variant="outline" onClick={() => downloadTemplate(template.headers, template.file)}><Download className="size-4"/>Download CSV</Button>
      <details className="text-sm"><summary className="cursor-pointer font-medium">Template columns</summary><p className="mt-2 break-words text-muted-foreground">{template.headers.join(', ')}</p></details>
    </article>)}</div>
    <div className="space-y-2 rounded-lg border bg-background p-4 text-sm"><h3 className="font-medium">Before you upload</h3>
      <ul className="list-disc space-y-2 pl-5">
        <li>Use one row per order line. Order ID, order date, SKU, quantity, and selling price or extended sales are required.</li>
        <li>Keep the source order ID stable. Supply a unique line ID within each order, especially when the same SKU appears more than once.</li>
        <li>Use dates such as 2026-09-09 or 09/09/2026 and numeric amounts without currency symbols. Preserve leading zeros in IDs and SKUs when editing in Excel.</li>
        <li>Costs must belong to the selected company. Leave unknown costs blank; shared catalog costs are never substituted.</li>
        <li>Standard prices and costs are per unit. Historical sales and costs are totals for the entire line. Use the selected company’s currency.</li>
        <li>Existing CSV, XLS, and XLSX exports can also be mapped directly. Review the validation preview before confirming an import.</li>
      </ul>
      <p className="pt-2 text-muted-foreground">These templates create reporting-only sales. Shipping-cost updates require a separate import type and are not supported here yet.</p>
    </div>
  </section>
}
