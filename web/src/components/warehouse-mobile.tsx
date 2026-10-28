import { useEffect, type ReactNode } from "react"
import { Archive, Boxes, CheckCircle2, Package, Menu, ScanBarcode } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MobileTables } from "@/components/ui/table"

const base = "/warehouse/mobile"
const sections = [
  { id: "receiving", label: "Receive POs", icon: Package },
  { id: "manual", label: "Other stock", icon: Archive },
  { id: "outbound", label: "Outbound", icon: ScanBarcode },
  { id: "audits", label: "Audits", icon: CheckCircle2 },
  { id: "more", label: "More", icon: Menu },
]

export function WarehouseMobile({ canPurchase, account, brand, receiving, manual, outbound, audits, bins, purchaseOrder, audit, returns, fulfillment, inventory }: {
  canPurchase: boolean
  account: ReactNode
  brand: ReactNode
  receiving: ReactNode
  manual: ReactNode
  outbound: ReactNode
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
  const activeSection = ["bins", "returns", "fulfillment", "inventory"].includes(section) ? "more" : section
  const id = parts[1] ? decodeURIComponent(parts[1]) : ""
  useEffect(() => {
    document.body.classList.add("warehouse-mobile-mode")
    return () => document.body.classList.remove("warehouse-mobile-mode")
  }, [])
  return <MobileTables><div className="warehouse-mobile min-h-dvh bg-background">
    <header className="border-b bg-card px-3 py-2"><div className="mx-auto flex max-w-3xl items-center justify-between gap-2"><a href={base} className="flex min-w-0 items-center gap-2">{brand}</a>{account}</div></header>
    <main className="mx-auto grid max-w-3xl gap-4 p-3 pb-28 sm:p-6 sm:pb-28">
      {id && <Button variant="outline" className="justify-self-start" asChild><a href={`${base}/${section}`}>← Back to {section === "receiving" ? "POs" : "audits"}</a></Button>}
      {section === "receiving" && (id ? canPurchase ? purchaseOrder(id) : <p>Your account does not have purchasing access.</p> : receiving)}
      {section === "manual" && manual}
      {section === "outbound" && outbound}
      {section === "audits" && (id ? audit(id) : audits)}
      {section === "bins" && bins}
      {section === "more" && <><h1 className="text-xl font-semibold">More warehouse tasks</h1><Button asChild variant="outline"><a href={`${base}/bins`}><Boxes className="size-4" /> Bins and locations</a></Button><Button asChild variant="outline"><a href={`${base}/returns`}>Customer returns / inspections</a></Button><Button asChild variant="outline"><a href={`${base}/fulfillment`}>Picking and fulfillment</a></Button><Button asChild variant="outline"><a href={`${base}/inventory`}>Inventory and transfers</a></Button></>}
      {section === "returns" && returns}
      {section === "fulfillment" && fulfillment}
      {section === "inventory" && inventory}
      {!["bins", "returns", "fulfillment", "inventory"].includes(section) && !sections.some(item => item.id === section) && <p>Page not found. Choose a warehouse task below.</p>}
    </main>
    <nav aria-label="Warehouse tasks" className="fixed inset-x-0 bottom-0 z-40 border-t bg-background pb-[env(safe-area-inset-bottom)]"><div className="mx-auto grid max-w-3xl grid-cols-5 gap-1 p-2">{sections.map(({ id: key, label, icon: Icon }) => <a key={key} href={`${base}/${key}`} aria-current={activeSection === key ? "page" : undefined} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-center text-xs font-medium ${activeSection === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}><Icon className="size-5" />{label}</a>)}</div></nav>
  </div></MobileTables>
}
