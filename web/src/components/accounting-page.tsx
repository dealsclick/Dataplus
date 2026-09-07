import { useEffect, useState } from "react"
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, Search } from "lucide-react"
import { AccountingLedger } from "./accounting-ledger"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Badge } from "./ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { accountingDateBounds, accountingDatePresets, accountingStatusLabel } from "../lib/accounting-filters"

type RecordRow = { id: string; orderId: string; orderNumber: string; channel: string; date: string; description: string; status: string; currency: string }
type Records = { rows: RecordRow[]; total: number; page: number; pageSize: number }
const ledgerHref = (id: string, view = "entries") => `/accounting?order=${encodeURIComponent(id)}&transactionsView=${view}`

export function AccountingPage() {
  const params = new URLSearchParams(window.location.search)
  const orderId = params.get("order") || ""
  const [tab, setTab] = useState(params.get("view") === "batches" ? "batches" : params.get("view") === "settings" ? "settings" : "journals")
  const [query, setQuery] = useState(params.get("q") || ""), [status, setStatus] = useState(params.get("status") || "")
  const [from, setFrom] = useState(params.get("from") || ""), [to, setTo] = useState(params.get("to") || "")
  const [datePreset, setDatePreset] = useState(params.get("from") || params.get("to") ? "custom" : "all")
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0)
  const [data, setData] = useState<Records | null>(null), [error, setError] = useState(""), [loading, setLoading] = useState(true)
  const [openOrder, setOpenOrder] = useState("")
  useEffect(() => {
    if (orderId || tab === "settings") return
    const controller = new AbortController()
    setLoading(true); setError("")
    const timer = setTimeout(async () => {
      const filters = new URLSearchParams({ kind: tab, q: query, status, from, to, page: String(page) })
      const location = new URLSearchParams({ view: tab, q: query, status, from, to })
      window.history.replaceState({}, "", `/accounting?${location}`)
      try {
        const response = await fetch(`/api/accounting/records?${filters}`, { signal: controller.signal })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || `Request failed: ${response.status}`)
        if (!controller.signal.aborted) setData(result)
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Unable to load accounting records") }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [orderId, tab, query, status, from, to, page, refresh])
  const changeTab = (value: string) => { setTab(value); setStatus(""); setPage(1); window.history.replaceState({}, "", `/accounting?view=${value}`) }
  return <main className="grid min-w-0 gap-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold">Accounting</h1>
      {orderId ? <Button asChild variant="outline"><a href="/accounting"><ArrowLeft className="size-4" />All accounting records</a></Button> : <form className="flex w-full flex-wrap gap-2 sm:w-auto" onSubmit={event => { event.preventDefault(); if (openOrder.trim()) window.location.assign(ledgerHref(openOrder.trim())) }}>
        <Input aria-label="Order ID or number" className="w-48 max-w-full" placeholder="Order ID or number" value={openOrder} onChange={event => setOpenOrder(event.target.value)} />
        <Button type="submit" variant="outline" disabled={!openOrder.trim()}><Search className="size-4" />Open ledger</Button>
      </form>}
    </header>
    {orderId ? <section className="grid min-w-0 gap-4"><a className="break-all text-sm text-primary underline" href={`/orders/${encodeURIComponent(orderId)}`}>View source order</a><AccountingLedger key={orderId} orderId={orderId} initialView={params.get("transactionsView") === "exports" ? "exports" : "entries"} /></section> : <>
      <Tabs value={tab} onValueChange={changeTab}><TabsList className="flex h-auto flex-wrap justify-start"><TabsTrigger value="journals">Journals</TabsTrigger><TabsTrigger value="batches">Export history</TabsTrigger><TabsTrigger value="settings">Account mappings</TabsTrigger></TabsList></Tabs>
      {tab === "settings" ? <AccountingLedger settingsOnly /> : <>
        <div className="grid grid-cols-2 items-end gap-3 lg:flex lg:flex-wrap">
          <Label className="col-span-2 grid min-w-0 gap-2 lg:min-w-56 lg:flex-1">Search<Input value={query} placeholder="Order, journal, channel, description" onChange={event => { setQuery(event.target.value); setPage(1) }} /></Label>
          <Label className="col-span-2 grid min-w-0 gap-2 lg:col-span-1">Status<Select value={status || "all"} onValueChange={value => { setStatus(value === "all" ? "" : value); setPage(1) }}><SelectTrigger className="w-full lg:w-64"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem>{(tab === "journals" ? ["draft", "posted", "discarded"] : ["exported", "imported"]).map(value => <SelectItem key={value} value={value}>{accountingStatusLabel(value)}</SelectItem>)}</SelectContent></Select></Label>
          <Label className="col-span-2 grid min-w-0 gap-2 lg:col-span-1">{tab === "journals" ? "Journal date" : "Export date"}<Select value={datePreset} onValueChange={value => { setDatePreset(value); if (value !== "custom") { const bounds = accountingDateBounds(value); setFrom(bounds.from); setTo(bounds.to) } setPage(1) }}><SelectTrigger className="w-full lg:w-44"><SelectValue /></SelectTrigger><SelectContent>{accountingDatePresets.map(preset => <SelectItem key={preset.value} value={preset.value}>{preset.label}</SelectItem>)}</SelectContent></Select></Label>
          <Label className="grid min-w-0 gap-2">From<Input className="min-w-0" type="date" value={from} onChange={event => { setFrom(event.target.value); setDatePreset("custom"); setPage(1) }} /></Label>
          <Label className="grid min-w-0 gap-2">To<Input className="min-w-0" type="date" value={to} onChange={event => { setTo(event.target.value); setDatePreset("custom"); setPage(1) }} /></Label>
          <Button variant="outline" size="icon" title="Refresh accounting records" onClick={() => setRefresh(value => value + 1)}><RefreshCw className="size-4" /></Button>
        </div>
        {error ? <p role="alert" className="text-destructive">{error}</p> : loading ? <p role="status">Loading accounting records...</p> : <>
          <div className="min-w-0 overflow-x-auto"><Table className="min-w-[720px]"><TableHeader><TableRow><TableHead>Date</TableHead><TableHead>{tab === "journals" ? "Journal" : "Batch"}</TableHead><TableHead>Order</TableHead><TableHead>Channel</TableHead><TableHead>{tab === "journals" ? "Description" : "Destination"}</TableHead><TableHead>Status</TableHead><TableHead>Currency</TableHead></TableRow></TableHeader><TableBody>{data?.rows.map(row => <TableRow key={`${row.orderId}:${row.id}`}><TableCell>{row.date}</TableCell><TableCell><a className="block max-w-48 truncate text-primary underline" title={row.id} href={ledgerHref(row.orderId, tab === "batches" ? "exports" : "entries")}>{row.id}</a></TableCell><TableCell><a className="text-primary underline" href={`/orders/${encodeURIComponent(row.orderId)}`}>{row.orderNumber}</a></TableCell><TableCell>{row.channel}</TableCell><TableCell className="max-w-80 whitespace-normal break-words">{row.description}</TableCell><TableCell><Badge variant="outline">{row.status}</Badge></TableCell><TableCell>{row.currency}</TableCell></TableRow>)}</TableBody></Table></div>
          {!data?.total && <p className="py-6 text-center text-sm text-muted-foreground">No {tab === "journals" ? "journal entries" : "export batches"} match these filters.</p>}
          <footer className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>{data?.total.toLocaleString() || 0} records / Page {page} of {Math.max(1, Math.ceil((data?.total || 0) / 50))}</span><div className="flex gap-2"><Button variant="outline" disabled={page === 1} onClick={() => setPage(value => value - 1)}><ChevronLeft className="size-4" />Previous</Button><Button variant="outline" disabled={page * 50 >= (data?.total || 0)} onClick={() => setPage(value => value + 1)}>Next<ChevronRight className="size-4" /></Button></div></footer>
        </>}
      </>}
    </>}
  </main>
}
