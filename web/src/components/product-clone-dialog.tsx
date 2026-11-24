import { Alert,AlertDescription,AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Command,CommandEmpty,CommandGroup,CommandInput,CommandItem,CommandList } from "@/components/ui/command"
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover,PopoverContent,PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { Boxes,Check,ChevronDown,Copy,Loader2 } from "lucide-react"
import { useEffect,useState } from "react"
import { toast } from "sonner"

import type { ProductItem } from "../App"
import { api } from "../lib/client-api"
import { Field } from "./app-ui"

type CloneSupplier = { id: string; name: string; code?: string; status?: string }
type CloneBrand = { id: string; name: string; status?: string }

export type ProductCloneSource = {
  sku: string
  title?: string
  image?: string
  brand?: string
  supplierId?: string
}

type ProductCloneDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  source: ProductCloneSource | null
  defaultSku?: string
  defaultTitle?: string
  defaultSupplierId?: string
  defaultVendorSku?: string
  onCreated: (item: ProductItem) => void
}

export function ProductCloneDialog({ open, onOpenChange, source, defaultSku, defaultTitle, defaultSupplierId, defaultVendorSku, onCreated }: ProductCloneDialogProps) {
  const [saving, setSaving] = useState(false)
  const [optionsLoading, setOptionsLoading] = useState(false)
  const [suppliers, setSuppliers] = useState<CloneSupplier[]>([])
  const [brands, setBrands] = useState<CloneBrand[]>([])
  const [supplierOpen, setSupplierOpen] = useState(false)
  const [brandOpen, setBrandOpen] = useState(false)
  const [draft, setDraft] = useState({ sku: "", title: "", supplierId: "", vendorSku: "", brand: "", copyContent: true, copyMedia: true, copyShipping: true, copyIdentifiers: false })

  const sourceSku = String(source?.sku || "").trim()
  useEffect(() => {
    if (!open || !sourceSku) return
    setDraft({
      sku: String(defaultSku || `${sourceSku}-COPY`).trim(),
      title: String(defaultTitle || source?.title || sourceSku).trim(),
      supplierId: String(defaultSupplierId || source?.supplierId || "").trim(),
      vendorSku: String(defaultVendorSku || "").trim(),
      brand: String(source?.brand || "").trim(),
      copyContent: true,
      copyMedia: true,
      copyShipping: true,
      copyIdentifiers: false,
    })
    setSuppliers([])
    setBrands([])
    setSupplierOpen(false)
    setBrandOpen(false)
    setOptionsLoading(true)
    const controller = new AbortController()
    void api<{ suppliers?: CloneSupplier[]; brands?: CloneBrand[] }>(`/api/inventory/${encodeURIComponent(sourceSku)}/clone-options`, { signal: controller.signal })
      .then((result) => {
        setSuppliers(result.suppliers || [])
        setBrands(result.brands || [])
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        toast.error(error instanceof Error ? error.message : "Unable to load supplier and brand choices.")
      })
      .finally(() => setOptionsLoading(false))
    return () => controller.abort()
  }, [open, sourceSku, defaultSku, defaultTitle, defaultSupplierId, defaultVendorSku, source?.title, source?.supplierId, source?.brand])

  const selectedSupplier = suppliers.find((supplier) => supplier.id === draft.supplierId)
  const selectedBrand = brands.find((brand) => brand.name.toLowerCase() === draft.brand.toLowerCase())

  const save = async () => {
    const newSku = draft.sku.trim()
    const title = draft.title.trim()
    if (!sourceSku) return toast.error("Choose a source SKU to clone.")
    if (!newSku) return toast.error("Enter the new SKU.")
    if (!title) return toast.error("Enter a product title.")
    if (saving) return
    setSaving(true)
    try {
      const result = await api<{ item: ProductItem; message?: string }>(`/api/inventory/${encodeURIComponent(sourceSku)}/clone`, {
        method: "POST",
        body: JSON.stringify({
          newSku,
          title,
          supplierId: draft.supplierId,
          vendorSku: draft.vendorSku.trim(),
          brand: draft.brand.trim(),
          copyContent: draft.copyContent,
          copyMedia: draft.copyMedia,
          copyShipping: draft.copyShipping,
          copyIdentifiers: draft.copyIdentifiers,
        })
      })
      toast.success(result.message || `${newSku} was created as an inactive draft.`)
      onCreated(result.item)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to duplicate this SKU.")
    } finally {
      setSaving(false)
    }
  }

  return <Dialog open={open} onOpenChange={(nextOpen) => { if (!saving) onOpenChange(nextOpen) }}>
    <DialogContent className="flex max-h-[100dvh] w-full max-w-none flex-col overflow-hidden p-0 sm:max-h-[94dvh] sm:max-w-3xl">
      <DialogHeader className="border-b px-5 py-4 pr-14 sm:px-6">
        <DialogTitle>Duplicate SKU</DialogTitle>
        <DialogDescription>Create an independent catalog product from {sourceSku || "the selected SKU"}. The duplicate starts inactive and must be reviewed before it can be sold.</DialogDescription>
      </DialogHeader>
      <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto px-5 py-5 sm:px-6">
        <div className="flex min-w-0 items-center gap-3 rounded-md border bg-muted/20 p-3">
          <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border bg-background">{source?.image ? <img src={source.image} alt="" className="size-full object-contain p-1" /> : <Boxes className="size-6 text-muted-foreground" />}</div>
          <div className="min-w-0"><p className="truncate text-sm font-medium">{source?.title || "Untitled product"}</p><p className="mt-1 font-mono text-xs text-muted-foreground">Source SKU: {sourceSku}</p></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New SKU"><Input autoFocus value={draft.sku} onChange={(event) => setDraft((current) => ({ ...current, sku: event.target.value }))} placeholder={`${sourceSku}-COPY`} /></Field>
          <Field label="Product title"><Input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Supplier</Label>
            <Popover open={supplierOpen} onOpenChange={setSupplierOpen}>
              <PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-expanded={supplierOpen} disabled={optionsLoading} className="w-full justify-between font-normal"><span className="truncate">{optionsLoading ? "Loading suppliers..." : selectedSupplier ? `${selectedSupplier.name}${selectedSupplier.code ? ` (${selectedSupplier.code})` : ""}` : "No supplier yet"}</span><ChevronDown className="size-4 shrink-0 opacity-60" /></Button></PopoverTrigger>
              <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0"><Command><CommandInput placeholder="Search supplier name or code..." /><CommandList className="max-h-72"><CommandEmpty>No canonical supplier found.</CommandEmpty><CommandGroup><CommandItem value="No supplier" onSelect={() => { setDraft((current) => ({ ...current, supplierId: "", vendorSku: "" })); setSupplierOpen(false) }}><Check className={cn("size-4", !draft.supplierId ? "opacity-100" : "opacity-0")} />No supplier yet</CommandItem>{suppliers.map((supplier) => <CommandItem key={supplier.id} value={`${supplier.name} ${supplier.code || ""}`} onSelect={() => { setDraft((current) => ({ ...current, supplierId: supplier.id })); setSupplierOpen(false) }}><Check className={cn("size-4", supplier.id === draft.supplierId ? "opacity-100" : "opacity-0")} /><span className="truncate">{supplier.name}{supplier.code ? ` (${supplier.code})` : ""}</span></CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent>
            </Popover>
            <p className="text-xs leading-5 text-muted-foreground">{selectedSupplier ? `${selectedSupplier.name} will be the primary supplier on the cloned SKU.` : "Search and select an existing supplier to avoid duplicate supplier names."}</p>
          </div>
          <div className="grid gap-1.5">
            <Label>Brand</Label>
            <Popover open={brandOpen} onOpenChange={setBrandOpen}>
              <PopoverTrigger asChild><Button type="button" variant="outline" role="combobox" aria-expanded={brandOpen} disabled={optionsLoading} className="w-full justify-between font-normal"><span className="truncate">{optionsLoading ? "Loading brands..." : draft.brand || "No brand"}</span><ChevronDown className="size-4 shrink-0 opacity-60" /></Button></PopoverTrigger>
              <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0"><Command><CommandInput placeholder="Search canonical brands..." /><CommandList className="max-h-72"><CommandEmpty>No canonical brand found.</CommandEmpty><CommandGroup><CommandItem value="No brand" onSelect={() => { setDraft((current) => ({ ...current, brand: "" })); setBrandOpen(false) }}><Check className={cn("size-4", !draft.brand ? "opacity-100" : "opacity-0")} />No brand</CommandItem>{brands.map((brand) => <CommandItem key={brand.id || brand.name} value={brand.name} onSelect={() => { setDraft((current) => ({ ...current, brand: brand.name })); setBrandOpen(false) }}><Check className={cn("size-4", brand.name.toLowerCase() === draft.brand.toLowerCase() ? "opacity-100" : "opacity-0")} /><span className="truncate">{brand.name}</span></CommandItem>)}</CommandGroup></CommandList></Command></PopoverContent>
            </Popover>
            <p className="text-xs leading-5 text-muted-foreground">{selectedBrand ? `${selectedBrand.name} is the saved canonical brand.` : draft.brand ? "The source brand is preserved. Choose a canonical brand if it needs correction." : "Select from existing brands so spelling stays consistent."}</p>
          </div>
        </div>
        <Field label="Supplier SKU"><Input value={draft.vendorSku} disabled={!draft.supplierId} onChange={(event) => setDraft((current) => ({ ...current, vendorSku: event.target.value }))} placeholder={draft.supplierId ? "Supplier item number for this PO" : "Select a supplier first"} /></Field>
        <div className="grid gap-3">
          <div><p className="text-sm font-medium">Choose what to copy</p><p className="text-xs text-muted-foreground">These choices copy reusable catalog details only. They never copy inventory or marketplace ownership.</p></div>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { key: "copyContent", label: "Content and categories", description: "Descriptions, attributes, tags, and category placement." },
              { key: "copyMedia", label: "Images and media", description: "Product images and saved media references." },
              { key: "copyShipping", label: "Dimensions and compliance", description: "Measurements, shipping class, SDS, and hazard fields." },
              { key: "copyIdentifiers", label: "UPC and manufacturer part number", description: "Off by default because duplicate identifiers can affect matching." },
            ].map((option) => {
              const key = option.key as "copyContent" | "copyMedia" | "copyShipping" | "copyIdentifiers"
              return <label key={key} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 hover:bg-muted/30"><Checkbox className="mt-0.5" checked={draft[key]} onCheckedChange={(checked) => setDraft((current) => ({ ...current, [key]: checked === true }))} /><span><span className="block text-sm font-medium">{option.label}</span><span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{option.description}</span></span></label>
            })}
          </div>
        </div>
        <Alert><Copy className="size-4" /><AlertTitle>Independent product, not a shadow</AlertTitle><AlertDescription>The new SKU will not share inventory with {sourceSku}. It starts with zero stock and no marketplace listings.</AlertDescription></Alert>
        <div className="rounded-md border border-amber-500/35 bg-amber-500/10 p-3"><p className="text-sm font-medium text-amber-900 dark:text-amber-100">Always starts clean</p><p className="mt-1 text-xs leading-5 text-amber-800 dark:text-amber-200">Zero physical stock, zero reserved quantity, no cost or selling price, no supplier offers or availability, no aliases or shadows, and no channel listing IDs.</p></div>
      </div>
      <DialogFooter className="border-t bg-background px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6"><Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={saving || !draft.sku.trim() || !draft.title.trim()} onClick={() => void save()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Copy className="size-4" />} Create duplicate</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
