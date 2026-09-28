import { useEffect, useRef, useState, type ReactNode } from "react"
import { Archive, Boxes, CheckCircle2, Package, Search, Loader2, Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { MobileTables } from "@/components/ui/table"

type Row = Record<string, unknown>
const base = "/warehouse/mobile"
const sections = [
  { id: "receiving", label: "Receive POs", icon: Package },
  { id: "manual", label: "Other stock", icon: Archive },
  { id: "audits", label: "Audits", icon: CheckCircle2 },
  { id: "bins", label: "Bins", icon: Boxes },
  { id: "more", label: "More", icon: Menu },
]

export function WarehouseMobile({ api, canPurchase, account, manual, audits, bins, purchaseOrder, audit, returns, fulfillment, inventory }: {
  api: <T>(url: string, options?: RequestInit) => Promise<T>
  canPurchase: boolean
  account: ReactNode
  manual: ReactNode
  audits: ReactNode
  bins: ReactNode
  returns: ReactNode
  fulfillment: ReactNode
  inventory: ReactNode
  purchaseOrder: (id: string) => ReactNode
  audit: (id: string) => ReactNode
}) {
  const parts = window.location.pathname.slice(base.length).split("/").filter(Boolean)
  const section = parts[0] || "receiving"
  const activeSection = ["returns", "fulfillment", "inventory"].includes(section) ? "more" : section
  const id = parts[1] ? decodeURIComponent(parts[1]) : ""
  useEffect(() => {
    document.body.classList.add("warehouse-mobile-mode")
    return () => document.body.classList.remove("warehouse-mobile-mode")
  }, [])
  return <MobileTables><div className="warehouse-mobile min-h-dvh bg-background">
    <header className="border-b bg-card px-4 py-3"><div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3"><a href={base} className="font-semibold">DataPlus · Warehouse</a><Button variant="outline" asChild><a href="/warehouse/warehouses">Full app</a></Button><div className="w-full">{account}</div></div></header>
    <main className="mx-auto grid max-w-3xl gap-4 p-3 pb-28 sm:p-6 sm:pb-28">
      {id && <Button variant="outline" className="justify-self-start" asChild><a href={`${base}/${section}`}>← Back to {section === "receiving" ? "POs" : "audits"}</a></Button>}
      {section === "receiving" && (canPurchase ? id ? purchaseOrder(id) : <PurchaseQueue api={api} /> : <p>Your account does not have purchasing access. Choose Other stock, Audits, or Bins below.</p>)}
      {section === "manual" && manual}
      {section === "audits" && (id ? audit(id) : audits)}
      {section === "bins" && bins}
      {section === "more" && <><h1 className="text-xl font-semibold">More warehouse tasks</h1><Button asChild variant="outline"><a href={`${base}/returns`}>Customer returns / inspections</a></Button><Button asChild variant="outline"><a href={`${base}/fulfillment`}>Picking and fulfillment</a></Button><Button asChild variant="outline"><a href={`${base}/inventory`}>Inventory and transfers</a></Button></>}
      {section === "returns" && returns}
      {section === "fulfillment" && fulfillment}
      {section === "inventory" && inventory}
      {!["returns", "fulfillment", "inventory"].includes(section) && !sections.some(item => item.id === section) && <p>Page not found. Choose a warehouse task below.</p>}
    </main>
    <nav aria-label="Warehouse tasks" className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)]"><div className="mx-auto grid max-w-3xl grid-cols-5 gap-1 p-2">{sections.map(({ id: key, label, icon: Icon }) => <a key={key} href={`${base}/${key}`} aria-current={activeSection === key ? "page" : undefined} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-center text-xs font-medium ${activeSection === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}><Icon className="size-5" />{label}</a>)}</div></nav>
  </div></MobileTables>
}

function PurchaseQueue({ api }: { api: <T>(url: string, options?: RequestInit) => Promise<T> }) {
  const [rows, setRows] = useState<Row[]>([])
  const [query, setQuery] = useState("")
  const [submitted, setSubmitted] = useState("")
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState("")
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const changeQuery = (value: string) => {
    request.current?.abort(); request.current = null
    setQuery(value); setSubmitted(""); setRows([]); setError(""); setLoading(false); setHasMore(false)
  }
  const search = async () => {
    const term = query.trim()
    if (!term) return
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true); setError(""); setRows([]); setSubmitted(term); setHasMore(false)
    try {
      const result = await api<{ purchaseOrders?: Row[]; hasMore?: boolean }>(`/api/purchasing/receiving-search?q=${encodeURIComponent(term)}`, { signal: controller.signal })
      if (request.current !== controller || controller.signal.aborted) return
      setRows(result.purchaseOrders || []); setHasMore(Boolean(result.hasMore))
    } catch (err) {
      if (request.current === controller && !controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to search POs")
    } finally {
      if (request.current === controller) setLoading(false)
    }
  }
  return <>
    <h1 className="text-xl font-semibold">Receive purchase orders</h1>
    <form className="grid gap-2" onSubmit={event => { event.preventDefault(); void search() }}>
      <label className="grid gap-2 text-sm font-medium">Scan or search PO number<Input autoFocus autoComplete="off" enterKeyHint="search" maxLength={120} value={query} onChange={event => changeQuery(event.target.value)} placeholder="PO number or supplier" /></label>
      <Button type="submit" disabled={loading || !query.trim()}>{loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Search POs</Button>
    </form>
    {!submitted ? <p className="text-sm text-muted-foreground">Scan or enter a PO number or supplier, then search to find a delivery.</p>
      : loading ? <p role="status">Searching purchase orders…</p>
      : error ? <div role="alert" className="text-destructive">{error}<Button variant="outline" onClick={() => void search()}>Retry search</Button></div>
      : <><p role="status" className="text-sm text-muted-foreground">{rows.length ? `${rows.length} matching purchase order${rows.length === 1 ? "" : "s"}` : "No open purchase orders match this search."}{hasMore && " · More matches available. Use a more specific PO number or supplier."}</p>{rows.map(row => <Card key={String(row.id)}><CardContent className="grid gap-3 p-4"><div className="flex flex-wrap justify-between gap-2"><strong>{String(row.poNumber || row.id)}</strong><span className="text-sm text-muted-foreground">{String(row.status || "draft").replaceAll("_", " ")}</span></div><p className="break-words">{String(row.supplier || "Unassigned supplier")}</p><p className="text-sm text-muted-foreground">{String(row.warehouseName || "No destination")} · Expected {String(row.expectedAt || "date unavailable").slice(0, 10)}</p><Button asChild><a href={`${base}/receiving/${encodeURIComponent(String(row.id))}`}>Open receiving</a></Button></CardContent></Card>)}</>}
  </>
}
