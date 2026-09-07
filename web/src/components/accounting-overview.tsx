import { useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react"
import { Button } from "./ui/button"
import { Label } from "./ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"

type Overview = {
  ledgerCount: number; capturedLedgerCount: number; draftCount: number; unconfirmedBatchCount: number;
  missingCostCount: number; pendingRefundCount: number; estimatedCount: number; total: number;
  rows: { id: string; orderId: string; orderNumber?: string; kind: string; channel: string; capturedAt: string; category: string }[];
}
const categories: Record<string, string> = { missing_cost: "Missing costs", pending_refund: "Pending refunds", estimated: "Estimated amounts" }

export function AccountingOverview() {
  const [data, setData] = useState<Overview | null>(null), [error, setError] = useState("")
  const [category, setCategory] = useState(""), [page, setPage] = useState(1), [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(true)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true); setError("")
    void (async () => {
      try {
        const response = await fetch(`/api/accounting/overview?${new URLSearchParams({ category, page: String(page) })}`, { signal: controller.signal })
        const next = await response.json()
        if (!response.ok) throw new Error(next.error || `Request failed: ${response.status}`)
        if (!controller.signal.aborted) setData(next)
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load overview") }
      finally { if (!controller.signal.aborted) setLoading(false) }
    })()
    return () => controller.abort()
  }, [category, page, refresh])
  return <section aria-label="Accounting overview" className="grid min-w-0 gap-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Accounting review</h2><Button variant="outline" size="icon" title="Refresh overview" onClick={() => setRefresh(value => value + 1)}><RefreshCw className="size-4" /></Button></div>
    {error ? <p role="alert" className="text-destructive">{error}</p> : loading ? <p role="status">Loading overview...</p> : data && <>
      <dl className="grid grid-cols-2 gap-4 border-y py-4 lg:grid-cols-5">
        <div><dt className="text-sm text-muted-foreground">Draft journals</dt><dd><a className="text-xl font-semibold text-primary underline" href="/accounting?view=journals&status=draft">{data.draftCount.toLocaleString()}</a></dd></div>
        <div><dt className="text-sm text-muted-foreground">Unconfirmed exports</dt><dd><a className="text-xl font-semibold text-primary underline" href="/accounting?view=batches&status=exported">{data.unconfirmedBatchCount.toLocaleString()}</a></dd></div>
        {Object.entries({ missing_cost: data.missingCostCount, pending_refund: data.pendingRefundCount, estimated: data.estimatedCount }).map(([key, count]) => <div key={key}><dt className="text-sm text-muted-foreground">{categories[key]}</dt><dd><button className="text-xl font-semibold text-primary underline" onClick={() => { setCategory(key); setPage(1) }} aria-label={`${categories[key]}: ${count}`}>{count.toLocaleString()}</button></dd></div>)}
      </dl>
      <p className="text-sm text-muted-foreground">Saved accounting data only / {data.capturedLedgerCount.toLocaleString()} of {data.ledgerCount.toLocaleString()} ledgers have captured observations / All dates</p>
      <Label className="grid gap-2">Source review<Select value={category || "all"} onValueChange={value => { setCategory(value === "all" ? "" : value); setPage(1) }}><SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All review items</SelectItem>{Object.entries(categories).map(([key, label]) => <SelectItem value={key} key={key}>{label}</SelectItem>)}</SelectContent></Select></Label>
      <div className="min-w-0 overflow-x-auto"><Table className="min-w-[660px]"><TableHeader><TableRow><TableHead>Order</TableHead><TableHead>Channel</TableHead><TableHead>Source amount</TableHead><TableHead>Review</TableHead><TableHead>Captured</TableHead></TableRow></TableHeader><TableBody>{data.rows.map(row => <TableRow key={`${row.orderId}:${row.id}`}><TableCell><a className="text-primary underline" href={`/accounting?order=${encodeURIComponent(row.orderId)}`}>{row.orderNumber || row.orderId}</a></TableCell><TableCell>{row.channel}</TableCell><TableCell className="max-w-72 whitespace-normal break-words">{row.kind}</TableCell><TableCell>{categories[row.category]}</TableCell><TableCell>{Number.isFinite(Date.parse(row.capturedAt)) ? new Date(row.capturedAt).toLocaleString() : "Unknown"}</TableCell></TableRow>)}</TableBody></Table></div>
      {!data.total && <p className="text-sm text-muted-foreground">No matching warnings in captured accounting data.</p>}
      <footer className="flex flex-wrap items-center justify-between gap-2 text-sm"><span>{data.total.toLocaleString()} source review items / Page {page} of {Math.max(1, Math.ceil(data.total / 50))}</span><div className="flex gap-2"><Button variant="outline" disabled={page === 1} onClick={() => setPage(value => value - 1)}><ChevronLeft className="size-4" />Previous</Button><Button variant="outline" disabled={page * 50 >= data.total} onClick={() => setPage(value => value + 1)}>Next<ChevronRight className="size-4" /></Button></div></footer>
    </>}
  </section>
}
