import { useEffect, useState, type ReactNode } from "react"
import { Archive, Boxes, CheckCircle2, Package, RefreshCw, Menu } from "lucide-react"
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

function PurchaseQueue({ api }: { api: <T>(url: string) => Promise<T> }) {
  const [rows, setRows] = useState<Row[]>([])
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const load = async () => {
    setLoading(true); setError("")
    try { const result = await api<{ purchaseOrders?: Row[] }>("/api/purchasing/work"); setRows(result.purchaseOrders || []) }
    catch (err) { setError(err instanceof Error ? err.message : "Unable to load POs") }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const pending = rows.filter(row => !["received", "closed", "canceled", "cancelled", "rejected", "superseded", "deleted"].includes(String(row.status).toLowerCase()))
  const matches = pending.filter(row => [row.poNumber, row.supplier, row.warehouseName, row.id].some(value => String(value || "").toLowerCase().includes(query.trim().toLowerCase())))
  return <>
    <div className="flex items-center justify-between gap-2"><h1 className="text-xl font-semibold">Receive purchase orders</h1><Button aria-label="Refresh purchase orders" variant="outline" disabled={loading} onClick={() => void load()}><RefreshCw className="size-4" /></Button></div>
    <label className="grid gap-2 text-sm font-medium">Scan or search PO number<Input autoFocus autoComplete="off" value={query} onChange={event => setQuery(event.target.value)} placeholder="PO number or supplier" onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (!loading && !error && matches.length === 1) window.location.assign(`${base}/receiving/${encodeURIComponent(String(matches[0].id))}`) } }} /></label>
    <p className="text-sm text-muted-foreground">Open a delivery, scan its items, then review the quantities.</p>
    {loading ? <p role="status">Loading purchase orders…</p> : error ? <div role="alert" className="text-destructive">{error}<Button variant="outline" onClick={() => void load()}>Retry</Button></div> : matches.length ? matches.map(row => <Card key={String(row.id)}><CardContent className="grid gap-3 p-4"><div className="flex flex-wrap justify-between gap-2"><strong>{String(row.poNumber || row.id)}</strong><span className="text-sm text-muted-foreground">{String(row.status || "draft").replaceAll("_", " ")}</span></div><p className="break-words">{String(row.supplier || "Unassigned supplier")}</p><p className="text-sm text-muted-foreground">{String(row.warehouseName || "No destination")} · Expected {String(row.expectedDeliveryDate || row.expectedAt || "date unavailable").slice(0, 10)}</p><Button asChild><a href={`${base}/receiving/${encodeURIComponent(String(row.id))}`}>Open receiving</a></Button></CardContent></Card>) : <p>No open purchase orders {query ? "match this search" : "to receive"}.</p>}
  </>
}
