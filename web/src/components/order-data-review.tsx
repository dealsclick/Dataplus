import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Download, MoreHorizontal, Pause, Play, RefreshCw } from "lucide-react"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
import { Input } from "./ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"

type Issue = { id: string; code: string; category: string; recordType: string; recordId: string; orderNumber: string; source: string; channelReference: string; orderDate: string; reason: string; action: string; sku?: string; poId?: string; poNumber?: string }
type Cursor = { stage: "orders" | "returns"; after: string }
const first: Cursor = { stage: "orders", after: "" }
const cell = (value: unknown) => { const text = String(value ?? ""); return `"${(/^[\s]*[=+@-]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"` }

export function OrderDataReview() {
  const [issues, setIssues] = useState<Issue[]>([]), [running, setRunning] = useState(false), [complete, setComplete] = useState(false)
  const [cursor, setCursor] = useState<Cursor>(first), [scanned, setScanned] = useState({ orders: 0, returns: 0 }), [error, setError] = useState("")
  const [canExport, setCanExport] = useState(false), [startedAt, setStartedAt] = useState("")
  const [category, setCategory] = useState("all"), [source, setSource] = useState("all"), [query, setQuery] = useState(""), [page, setPage] = useState(1)
  const sequence = useRef(0)
  useEffect(() => {
    if (!running) return
    const controller = new AbortController(), run = sequence.current
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/orders/data-review?${new URLSearchParams(cursor)}`, { signal: controller.signal })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || `Review failed (${response.status})`)
        if (controller.signal.aborted || run !== sequence.current) return
        setIssues(current => [...current, ...result.issues]); setCanExport(result.canExport === true)
        setScanned(current => ({ ...current, [cursor.stage]: current[cursor.stage] + result.scanned }))
        if (result.next) setCursor(result.next)
        else { setComplete(true); setRunning(false) }
      } catch (e) { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : "Review unavailable"); setRunning(false) } }
    }, 1000)
    return () => { controller.abort(); clearTimeout(timer) }
  }, [running, cursor])
  const start = () => { sequence.current++; setIssues([]); setScanned({ orders: 0, returns: 0 }); setCursor({ ...first }); setComplete(false); setError(""); setPage(1); setStartedAt(new Date().toISOString()); setRunning(true) }
  const rows = issues.filter(row => (category === "all" || row.category === category) && (source === "all" || row.source === source) && (!query || [row.orderNumber, row.channelReference, row.sku, row.reason, row.code].join(" ").toLowerCase().includes(query.toLowerCase())))
  const pageCount = Math.max(1, Math.ceil(rows.length / 50)), activePage = Math.min(page, pageCount)
  const exportCsv = () => {
    const columns = ["Scan started", "Scan status", "Category", "Issue", "Record type", "Internal ID", "Order number", "Channel", "Channel reference", "SKU", "PO", "Reason", "Suggested review"]
    const csv = [columns.map(cell).join(","), ...rows.map(row => [startedAt, complete ? "Completed scan" : "Partial scan", row.category, row.code, row.recordType, row.recordId, row.orderNumber, row.source, row.channelReference, row.sku, row.poNumber, row.reason, row.action].map(cell).join(","))].join("\r\n")
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" })), link = document.createElement("a")
    link.href = url; link.download = `order-data-review-${complete ? "complete" : "partial"}-${startedAt.slice(0, 10)}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000)
  }
  const operational = issues.filter(row => row.category === "operational").length
  return <main className="grid min-w-0 gap-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><a className="mb-2 flex items-center gap-1 text-sm text-primary" href="/orders"><ArrowLeft className="size-4" />Orders</a><h1 className="text-2xl font-semibold">Data Review</h1></div><DropdownMenu><DropdownMenuTrigger asChild><Button><MoreHorizontal className="size-4" />Actions</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem disabled={running} onSelect={start}><RefreshCw className="size-4" />{startedAt ? "Start new review" : "Start review"}</DropdownMenuItem>{running ? <DropdownMenuItem onSelect={() => setRunning(false)}><Pause className="size-4" />Pause review</DropdownMenuItem> : startedAt && !complete ? <DropdownMenuItem onSelect={() => { setError(""); setRunning(true) }}><Play className="size-4" />Resume review</DropdownMenuItem> : null}<DropdownMenuItem disabled={!canExport || !rows.length} onSelect={exportCsv}><Download className="size-4" />Download filtered CSV</DropdownMenuItem></DropdownMenuContent></DropdownMenu></header>
    <div className="flex flex-wrap items-center gap-3 border-y py-3 text-sm"><Badge variant="outline">{running ? `Reviewing ${cursor.stage}` : complete ? "Review complete" : startedAt ? "Paused" : "Not started"}</Badge><span>{scanned.orders.toLocaleString()} orders checked</span><span>{scanned.returns.toLocaleString()} returns checked</span><span className="font-medium">{operational.toLocaleString()} operational issues</span><span>{(issues.length - operational).toLocaleString()} reporting gaps</span></div>
    <p className="text-sm text-muted-foreground">Read-only review of saved data. Orders added or updated during this scan may need another review. Reporting gaps do not move orders into Exceptions. Repeated channel references are allowed.</p>
    {error && <p role="alert" className="text-destructive">{error} Completed batches are retained; resume to retry this batch.</p>}
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_180px]"><Input aria-label="Search review findings" placeholder="Order, SKU, channel reference or issue" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} /><Select value={category} onValueChange={value => { setCategory(value); setPage(1) }}><SelectTrigger aria-label="Issue category"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All findings</SelectItem><SelectItem value="operational">Operational issues</SelectItem><SelectItem value="reporting">Reporting gaps</SelectItem></SelectContent></Select><Select value={source} onValueChange={value => { setSource(value); setPage(1) }}><SelectTrigger aria-label="Channel"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All channels</SelectItem>{[...new Set(issues.map(row => row.source).filter(Boolean))].sort().map(name => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent></Select></div>
    <div className="min-w-0 overflow-x-auto"><Table className="min-w-[840px]"><TableHeader><TableRow><TableHead>Order / return</TableHead><TableHead>Channel</TableHead><TableHead>Category</TableHead><TableHead>Finding</TableHead><TableHead>Suggested review</TableHead></TableRow></TableHeader><TableBody>{rows.slice((activePage - 1) * 50, activePage * 50).map(row => <TableRow key={row.id}><TableCell><a className="text-primary underline" href={row.recordType === "order" ? `/orders/${encodeURIComponent(row.recordId)}` : "/returns"}>{row.orderNumber || row.recordId}</a>{row.sku && <p className="text-xs">{row.sku}</p>}{row.poId && <a className="block text-xs text-primary underline" href={`/purchase-orders/${encodeURIComponent(row.poId)}`}>{row.poNumber}</a>}</TableCell><TableCell className="max-w-52 whitespace-normal break-words">{row.source}<p className="text-xs text-muted-foreground">{row.channelReference}</p></TableCell><TableCell><Badge variant={row.category === "operational" ? "warning" : "outline"}>{row.category}</Badge></TableCell><TableCell className="max-w-80 whitespace-normal">{row.reason}</TableCell><TableCell className="max-w-80 whitespace-normal text-muted-foreground">{row.action}</TableCell></TableRow>)}</TableBody></Table></div>
    {!rows.length && <p className="py-6 text-center text-sm text-muted-foreground">{!startedAt ? "No review has been run." : running ? "No matching findings in the batches checked so far." : complete ? "No findings match the current filters." : "No matching findings in this partial review."}</p>}
    <footer className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>{rows.length.toLocaleString()} findings / Page {activePage} of {pageCount}{!complete && startedAt ? " / Partial review" : ""}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={activePage === 1} onClick={() => setPage(activePage - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={activePage >= pageCount} onClick={() => setPage(activePage + 1)}>Next</Button></div></footer>
  </main>
}
