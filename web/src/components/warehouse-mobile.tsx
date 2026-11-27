import { useEffect, useState, type ReactNode } from "react"
import { Archive, ArrowLeft, Boxes, CheckCircle2, Package, Menu, RotateCcw, ScanBarcode, Wifi, WifiOff } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MobileTables } from "@/components/ui/table"
import { cn } from "@/lib/utils"

const base = "/warehouse/mobile"
const sections = [
  { id: "receiving", label: "Receive POs", icon: Package },
  { id: "returns", label: "Returns", icon: RotateCcw },
  { id: "outbound", label: "Outbound", icon: ScanBarcode },
  { id: "audits", label: "Audits", icon: CheckCircle2 },
  { id: "more", label: "More", icon: Menu },
]

export function isInstalledWarehouseApp() {
  if (typeof window === "undefined") return false
  const nativeWarehouseWebView = /\bDataPlusWarehouse\//i.test(window.navigator.userAgent)
  const navigatorStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  const trustedAndroidLaunch = document.referrer.startsWith("android-app://com.dataplus.warehouse")
  let trustedAndroidSession = false
  try {
    if (trustedAndroidLaunch) window.sessionStorage.setItem("dataplus.warehouse.android-app", "1")
    trustedAndroidSession = window.sessionStorage.getItem("dataplus.warehouse.android-app") === "1"
  } catch {
    // Storage can be unavailable in locked-down webviews; launch and display mode still identify the app.
  }
  return nativeWarehouseWebView
    || navigatorStandalone
    || trustedAndroidLaunch
    || trustedAndroidSession
    || window.matchMedia("(display-mode: standalone)").matches
}

export function WarehouseMobile({ canPurchase, installedApp = false, account, brand, receiving, manual, outbound, audits, bins, purchaseOrder, audit, returns, fulfillment, inventory }: {
  canPurchase: boolean
  installedApp?: boolean
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
  const [online, setOnline] = useState(() => navigator.onLine)
  const parts = window.location.pathname.slice(base.length).split("/").filter(Boolean)
  const section = parts[0] || "receiving"
  const activeSection = ["bins", "manual", "fulfillment", "inventory"].includes(section) ? "more" : section
  const id = parts[1] ? decodeURIComponent(parts[1]) : ""
  useEffect(() => {
    const previousTitle = document.title
    let manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    const createdManifest = !manifest
    if (!manifest) {
      manifest = document.createElement("link")
      manifest.rel = "manifest"
      manifest.href = "/warehouse.webmanifest"
      manifest.dataset.warehouseManifest = "true"
      document.head.appendChild(manifest)
    }
    const updateOnlineStatus = () => setOnline(navigator.onLine)
    document.title = "DataPlus Warehouse"
    document.body.classList.add("warehouse-mobile-mode")
    window.addEventListener("online", updateOnlineStatus)
    window.addEventListener("offline", updateOnlineStatus)
    return () => {
      document.title = previousTitle
      document.body.classList.remove("warehouse-mobile-mode")
      window.removeEventListener("online", updateOnlineStatus)
      window.removeEventListener("offline", updateOnlineStatus)
      if (createdManifest) manifest?.remove()
    }
  }, [])
  return <MobileTables><div className={cn("warehouse-mobile min-h-dvh", installedApp ? "bg-muted/30" : "bg-background")} data-mobile-app-shell={installedApp ? "android" : "web"}>
    <header className={cn("border-b px-3 py-2", installedApp ? "sticky top-0 z-40 bg-background/95 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/85" : "bg-card")}><div className="mx-auto flex max-w-3xl items-center justify-between gap-2"><div className="flex min-w-0 items-center gap-1">{id && <Button size="icon" variant="ghost" className={cn("shrink-0", installedApp ? "size-10 rounded-full" : "size-9")} title={`Back to ${section === "receiving" ? "POs" : "audits"}`} aria-label={`Back to ${section === "receiving" ? "POs" : "audits"}`} asChild><a href={`${base}/${section}`}><ArrowLeft className="size-5" /></a></Button>}<a href={base} className="flex min-w-0 items-center gap-2">{brand}</a></div><div className="flex shrink-0 items-center gap-2"><Badge variant={online ? "success" : "destructive"} title={online ? "Connected" : "No network connection"}>{online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}<span className="hidden min-[390px]:inline">{online ? "Online" : "Offline"}</span></Badge>{account}</div></div></header>
    {!online && <div role="alert" className="border-b border-red-500/40 bg-red-500/10 px-3 py-2 text-center text-sm font-medium text-red-700 dark:text-red-300"><WifiOff className="mr-1.5 inline size-4" />Offline — scans and updates cannot be saved until the connection returns.</div>}
    <main className={cn("mx-auto grid max-w-3xl p-3 sm:p-6 sm:pb-32", installedApp ? "gap-3 pb-[calc(7.5rem+env(safe-area-inset-bottom))]" : "gap-4 pb-[calc(8rem+env(safe-area-inset-bottom))]")}>
      {section === "receiving" && (id ? canPurchase ? purchaseOrder(id) : <p>Your account does not have purchasing access.</p> : receiving)}
      {section === "manual" && manual}
      {section === "outbound" && outbound}
      {section === "audits" && (id ? audit(id) : audits)}
      {section === "bins" && bins}
      {section === "more" && <><h1 className="text-xl font-semibold">More warehouse tasks</h1><Button asChild variant="outline"><a href={`${base}/manual`}><Archive className="size-4" /> Other stock receiving</a></Button><Button asChild variant="outline"><a href={`${base}/bins`}><Boxes className="size-4" /> Bins and locations</a></Button><Button asChild variant="outline"><a href={`${base}/fulfillment`}>Picking and fulfillment</a></Button><Button asChild variant="outline"><a href={`${base}/inventory`}>Inventory and transfers</a></Button></>}
      {section === "returns" && returns}
      {section === "fulfillment" && fulfillment}
      {section === "inventory" && inventory}
      {!["bins", "manual", "fulfillment", "inventory"].includes(section) && !sections.some(item => item.id === section) && <p>Page not found. Choose a warehouse task below.</p>}
    </main>
    <nav aria-label="Warehouse tasks" className={cn("fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)]", installedApp ? "bg-background/95 shadow-[0_-6px_24px_rgba(0,0,0,.08)] backdrop-blur supports-[backdrop-filter]:bg-background/90" : "bg-background")}><div className={cn("mx-auto grid max-w-3xl grid-cols-5 gap-1", installedApp ? "px-2 py-1.5" : "p-2")}>{sections.map(({ id: key, label, icon: Icon }) => <a key={key} href={`${base}/${key}`} aria-current={activeSection === key ? "page" : undefined} className={installedApp ? `flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-center text-[11px] font-medium transition-colors ${activeSection === key ? "text-primary" : "text-muted-foreground hover:bg-muted"}` : `flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-center text-xs font-medium ${activeSection === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{installedApp ? <span className={`grid h-7 min-w-14 place-items-center rounded-full px-4 ${activeSection === key ? "bg-primary/15" : ""}`}><Icon className="size-5" /></span> : <Icon className="size-5" />}{label}</a>)}</div></nav>
  </div></MobileTables>
}
