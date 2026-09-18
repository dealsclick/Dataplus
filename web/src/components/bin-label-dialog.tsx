import { useState } from "react"
import { Printer, Search } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { binLabelFormats, binLabelGrid, buildBinLabelDocument, type BinLabel } from "@/lib/bin-labels"

export function BinLabelDialog({ open, onOpenChange, bins, warehouse }: { open: boolean; onOpenChange: (open: boolean) => void; bins: BinLabel[]; warehouse: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState("")
  const [formatId, setFormatId] = useState("1.5x1")
  const [copies, setCopies] = useState("1")
  const [left, setLeft] = useState("0.5")
  const [top, setTop] = useState("0.5")
  const [gapX, setGapX] = useState("0")
  const [gapY, setGapY] = useState("0")
  const format = binLabelFormats.find(item => item.id === formatId) || binLabelFormats[5]
  const layout = { width: format.width, height: format.height, left: Number(left), top: Number(top), gapX: Number(gapX), gapY: Number(gapY) }
  const uniqueBins = [...new Map(bins.filter(bin => bin.code).map(bin => [bin.code, bin])).values()]
  const chosen = uniqueBins.filter(bin => selected.has(bin.code))
  const filtered = uniqueBins.filter(bin => `${bin.code} ${bin.name || ""}`.toLowerCase().includes(query.toLowerCase()))
  let perPage = 0, layoutError = ""
  try { perPage = binLabelGrid(layout).perPage } catch (error) { layoutError = (error as Error).message }
  const print = () => {
    try {
      const html = buildBinLabelDocument(chosen, warehouse, layout, Number(copies))
      const tab = window.open("", "_blank")
      if (!tab) throw new Error("Allow pop-ups to open the label print preview.")
      tab.opener = null
      tab.document.open(); tab.document.write(html); tab.document.close()
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to prepare labels.") }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="flex max-h-[92dvh] flex-col overflow-hidden sm:max-w-2xl"><DialogHeader><DialogTitle>Print bin labels</DialogTitle><DialogDescription>{warehouse} · Select bins and a label size. Barcodes contain the exact bin code.</DialogDescription></DialogHeader>
    <div className="min-h-0 space-y-4 overflow-y-auto px-1">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_100px]"><div className="space-y-1"><Label>Size format</Label><Select value={formatId} onValueChange={id => { const next = binLabelFormats.find(item => item.id === id)!; setFormatId(id); setLeft(String(next.margin)); setTop("0.5"); setGapX("0"); setGapY("0") }}><SelectTrigger aria-label="Label size" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{binLabelFormats.map(item => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-1"><Label htmlFor="bin-label-copies">Copies / bin</Label><Input id="bin-label-copies" type="number" min="1" max="100" value={copies} onChange={event => setCopies(event.target.value)} /></div></div>
      <p className="text-xs text-muted-foreground">Paper: US Letter, 8.5 × 11 inches. {layoutError || `${perPage} labels per sheet · ${chosen.length * (Number(copies) || 0)} labels selected.`} Print at 100% / Actual size with headers and footers off.</p>
      <details><summary className="cursor-pointer text-sm">Sheet alignment (inches)</summary><div className="mt-2 grid grid-cols-2 gap-2">{[["Left / right margin", left, setLeft], ["Top / bottom margin", top, setTop], ["Column gap", gapX, setGapX], ["Row gap", gapY, setGapY]].map(([title, value, setter]) => <label key={String(title)} className="space-y-1 text-xs">{String(title)}<Input aria-label={String(title)} type="number" min="0" step="0.01" value={String(value)} onChange={event => (setter as (value: string) => void)(event.target.value)} /></label>)}</div></details>
      <div className="relative"><Search className="absolute left-3 top-3 size-4 text-muted-foreground" /><Input className="pl-9" aria-label="Search bins to print" placeholder="Search bins" value={query} onChange={event => setQuery(event.target.value)} /></div>
      <div className="flex items-center justify-between gap-2"><p className="text-sm">{chosen.length} of {uniqueBins.length} bins selected</p><div className="flex gap-1"><Button size="sm" variant="ghost" onClick={() => setSelected(new Set(uniqueBins.map(bin => bin.code)))}>Select all</Button><Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button></div></div>
      <div className="max-h-64 divide-y overflow-y-auto rounded-md border">{filtered.map(bin => <label key={bin.code} className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2"><Checkbox checked={selected.has(bin.code)} aria-label={`Print bin ${bin.code}`} onCheckedChange={checked => setSelected(previous => { const next = new Set(previous); if (checked === true) next.add(bin.code); else next.delete(bin.code); return next })} /><span className="min-w-0 text-sm"><span className="break-all font-medium">{bin.code}</span>{bin.name && <span className="ml-2 text-muted-foreground">{bin.name}</span>}{bin.active === false && <span className="ml-2 text-xs text-muted-foreground">Inactive</span>}</span></label>)}{!filtered.length && <p className="p-3 text-sm text-muted-foreground">{uniqueBins.length ? "No bins match this search." : "No bins are configured for this warehouse."}</p>}</div>
    </div><DialogFooter className="shrink-0"><Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button><Button disabled={!chosen.length || Boolean(layoutError)} onClick={print}><Printer className="size-4" />Preview &amp; print</Button></DialogFooter>
  </DialogContent></Dialog>
}
