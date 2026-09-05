import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"

type Row = Record<string, unknown>
const rows = (value: unknown): Row[] => Array.isArray(value) ? value as Row[] : []
const money = (value: unknown, currency: unknown) => new Intl.NumberFormat("en-US", { style: "currency", currency: String(currency || "USD") }).format(Number(value || 0))

export function OrderReturnDetails({ record, trackingUrl }: { record: Row; trackingUrl: (row: Row, carrier: string, number: string) => string }) {
  return <section className="min-w-0 basis-full border-t pt-3 text-sm">
    <dl className="grid gap-3 sm:grid-cols-3">
      <div><dt className="text-muted-foreground">Channel return</dt><dd className="break-all">{String(record.source || "Local")} {String(record.channelReturnId || "")}</dd><dd>{String(record.channelStatus || "Local only")}</dd></div>
      <div><dt className="text-muted-foreground">Refund</dt><dd>{record.actualRefundAmount != null ? `${money(record.actualRefundAmount, record.currency)} confirmed` : `${money(record.estimatedRefundAmount ?? record.amount, record.currency)} estimated`}</dd></div>
      <div><dt className="text-muted-foreground">Warehouse receiving</dt><dd>{String(record.receivingStatus || (record.receivedAt ? "Received" : "Not received in DataPlus"))}</dd></div>
    </dl>
    <div className="mt-3 overflow-x-auto"><Table><TableHeader><TableRow><TableHead>SKU / Item</TableHead><TableHead>Requested</TableHead><TableHead>Received</TableHead></TableRow></TableHeader><TableBody>{rows(record.items).map((line, index) => <TableRow key={index}><TableCell><span className="font-medium">{String(line.sku || "Unmatched SKU")}</span><p className="max-w-80 whitespace-normal text-muted-foreground">{String(line.title || "")}</p></TableCell><TableCell>{Number(line.qty || 0)}</TableCell><TableCell>{Number(line.receivedQty || 0)}</TableCell></TableRow>)}</TableBody></Table></div>
    {rows(record.returnTracking).map((tracking, index) => { const url = trackingUrl(tracking, String(tracking.carrier || ""), String(tracking.trackingNumber || "")); return <p className="mt-2 break-all" key={index}>{String(tracking.carrier || "Carrier not supplied")} / {url ? <a className="text-primary underline" href={url} target="_blank" rel="noopener noreferrer">{String(tracking.trackingNumber)}</a> : String(tracking.trackingNumber || "")} <span className="text-muted-foreground">{String(tracking.status || "")}</span></p> })}
  </section>
}

export function ReturnReceiptFields({ record, warehouses, draft, setDraft }: { record: Row | null; warehouses: Row[]; draft: Record<string, string>; setDraft: (next: Record<string, string>) => void }) {
  const physical = warehouses.filter((row) => row.isPhysical !== false && row.active !== false && String(row.status).toLowerCase() !== "inactive" && !/virtual|supplier|transfer/i.test(String(row.type || row.warehouseType || "") + String(row.inventorySourceType || "")) && !/datawarehouse/i.test(String(row.name || "")))
  return <section className="grid gap-3 border-t pt-3">
    <Label>Receiving warehouse<Select value={draft.warehouseId || ""} onValueChange={(warehouseId) => setDraft({ ...draft, warehouseId })}><SelectTrigger><SelectValue placeholder="Choose physical warehouse" /></SelectTrigger><SelectContent>{physical.map((row) => <SelectItem key={String(row.id)} value={String(row.id)}>{String(row.name)}</SelectItem>)}</SelectContent></Select></Label>
    <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>SKU</TableHead><TableHead>Requested</TableHead><TableHead>Physically received</TableHead></TableRow></TableHeader><TableBody>{rows(record?.items).map((line, index) => <TableRow key={index}><TableCell>{String(line.sku || "Unmatched SKU")}</TableCell><TableCell>{Number(line.qty || 0)}</TableCell><TableCell><Input aria-label={`Received ${String(line.sku || index)}`} className="w-24" type="number" min={0} max={Number(line.qty || 0)} step={1} disabled={Boolean(record?.restockedAt)} value={draft[`received-${index}`] ?? String(line.receivedQty || 0)} onChange={(event) => setDraft({ ...draft, [`received-${index}`]: event.target.value })} /></TableCell></TableRow>)}</TableBody></Table></div>
  </section>
}
