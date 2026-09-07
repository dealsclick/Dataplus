import { useState } from "react"
import { ScanLine, Trash2 } from "lucide-react"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Textarea } from "./ui/textarea"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { ReturnReceiptFields } from "./order-return-details"

type Row = Record<string, unknown>
type Photo = { id: string; name: string; size: number; mimeType: string; dataUrl: string; stage: string }
const rows = (value: unknown): Row[] => Array.isArray(value) ? value : []
async function json(path: string, body?: unknown) {
  const response = await fetch(path, body ? { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : undefined)
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || `Request failed: ${response.status}`)
  return result
}

export function ReturnReceiving({ warehouses, onUpdated }: { warehouses: Row[]; onUpdated: () => Promise<void> }) {
  const [query, setQuery] = useState(""), [matches, setMatches] = useState<Row[]>([]), [total, setTotal] = useState<number | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("")
  const [record, setRecord] = useState<Row | null>(null), [draft, setDraft] = useState<Record<string, string>>({}), [photos, setPhotos] = useState<Photo[]>([])
  async function lookup() {
    setBusy(true); setError(""); setMessage(""); setMatches([]); setTotal(null)
    try { const result = await json(`/api/returns/receiving-lookup?q=${encodeURIComponent(query.trim())}`); setMatches(result.returns || []); setTotal(result.total) }
    catch (e) { setError(e instanceof Error ? e.message : "Lookup failed") }
    finally { setBusy(false) }
  }
  function open(row: Row) {
    setRecord(row); setError(""); setPhotos([])
    setDraft({ warehouseId: String(row.warehouseId || ""), binLocation: String(row.binLocation || ""), condition: String(row.condition || "Unknown"), disposition: String(row.disposition === "restock" ? "restock" : "quarantine"), inspectionNotes: String(row.inspectionNotes || ""), ...Object.fromEntries(rows(row.items).map((line, index) => [`received-${index}`, String(line.receivedQty || 0)])) })
  }
  async function addPhotos(files: FileList | null) {
    if (!files) return
    setBusy(true); setError("")
    try {
      if (files.length + photos.length > 3) throw new Error("Add up to 3 photos per receipt.")
      const next: Photo[] = []
      for (const file of Array.from(files)) {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 1024 * 1024) throw new Error("Use JPEG, PNG or WebP photos up to 1 MB each.")
        const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Unable to read photo")); reader.readAsDataURL(file) })
        next.push({ id: crypto.randomUUID(), name: file.name, size: file.size, mimeType: file.type, dataUrl, stage: "received" })
      }
      setPhotos(current => [...current, ...next])
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to add photos") }
    finally { setBusy(false) }
  }
  async function save() {
    if (!record) return
    setBusy(true); setError("")
    try {
      const items = rows(record.items).map((line, index) => ({ ...line, receivedQty: Number(draft[`received-${index}`] || 0) }))
      if (!items.length || !items.some(line => line.receivedQty > 0)) throw new Error("Enter the quantities physically received.")
      await json(`/api/returns/${encodeURIComponent(String(record.id))}`, { ...draft, status: "received", inspectionStatus: "pending", receiptOnly: true, expectedUpdatedAt: String(record.updatedAt || ""), items, attachments: photos })
      setRecord(null); setMatches([]); setTotal(null); setQuery(""); setMessage("Receipt saved. Stock remains unavailable until inspection and restock approval.")
      await onUpdated()
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save receipt") }
    finally { setBusy(false) }
  }
  return <section aria-label="Return receiving" className="grid min-w-0 gap-3 border-y py-4">
    <h2 className="font-semibold">Receive a return</h2>
    <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); if (!busy) void lookup() }}><Label className="grid min-w-0 flex-1 gap-2">Return, order or tracking number<Input value={query} maxLength={200} onChange={event => setQuery(event.target.value)} autoComplete="off" /></Label><Button disabled={busy || !query.trim()}><ScanLine className="size-4" />Find return</Button></form>
    {!record && error && <p role="alert" className="text-sm text-destructive">{error}</p>}{message && <p role="status" className="text-sm">{message}</p>}
    {total === 0 && <p className="text-sm text-muted-foreground">No exact match in saved returns.</p>}
    {total !== null && total > 50 && <p className="text-sm text-muted-foreground">Showing 50 of {total} matches. Use the return number to narrow the search.</p>}
    <div className="divide-y">{matches.map(row => <div key={String(row.id)} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><div className="min-w-0 break-words"><p className="font-medium">{String(row.returnNumber || row.channelReturnId || row.id)} / {String(row.source || "Local")}</p><p>Order {String(row.orderNumber || row.channelOrderId || "Unmatched")} / Channel: {String(row.channelStatus || row.channelLifecycleStatus || "Unknown")} / Receiving: {String(row.receivingStatus || "Not received")}</p></div><Button variant="outline" disabled={busy || Boolean(row.restockedAt)} onClick={() => open(row)}>{row.restockedAt ? "Already restocked" : "Receive"}</Button></div>)}</div>
    <Dialog open={Boolean(record)} onOpenChange={value => { if (!value && !busy) setRecord(null) }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle className="break-all">Receive {String(record?.returnNumber || record?.channelReturnId || "return")}</DialogTitle></DialogHeader>
      <p className="text-sm text-muted-foreground">Channel status: {String(record?.channelStatus || record?.channelLifecycleStatus || "Unknown")} / Local receiving only</p>
      <ReturnReceiptFields record={record} warehouses={warehouses} draft={draft} setDraft={setDraft} />
      <div className="grid gap-3 sm:grid-cols-2"><Label className="grid gap-2">Bin / receiving location<Input value={draft.binLocation || ""} onChange={event => setDraft({ ...draft, binLocation: event.target.value })} /></Label><Label className="grid gap-2">Condition<Select value={draft.condition || "Unknown"} onValueChange={condition => setDraft({ ...draft, condition })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Unknown", "New", "Opened", "Damaged"].map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></Label></div>
      <Label className="grid gap-2">Proposed disposition<Select value={draft.disposition || "quarantine"} onValueChange={disposition => setDraft({ ...draft, disposition })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="quarantine">Quarantine</SelectItem><SelectItem value="restock">Restock after inspection</SelectItem><SelectItem value="dispose">Damaged / dispose after inspection</SelectItem><SelectItem value="return_to_vendor">Return to vendor</SelectItem></SelectContent></Select></Label>
      <Label className="grid gap-2">Inspection notes<Textarea value={draft.inspectionNotes || ""} onChange={event => setDraft({ ...draft, inspectionNotes: event.target.value })} /></Label>
      <Label className="grid gap-2">Receipt photos<Input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={event => { void addPhotos(event.target.files); event.target.value = "" }} /></Label>
      <div className="flex flex-wrap gap-3">{photos.map(photo => <div key={photo.id} className="flex items-center gap-1"><a href={photo.dataUrl} target="_blank" rel="noopener noreferrer"><img src={photo.dataUrl} alt={photo.name} className="size-16 rounded object-cover" /></a><Button size="icon" variant="ghost" title={`Remove ${photo.name}`} disabled={busy} onClick={() => setPhotos(current => current.filter(row => row.id !== photo.id))}><Trash2 className="size-4" /></Button></div>)}</div>
      {record && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter className="sticky bottom-0 bg-background py-2"><Button variant="outline" disabled={busy} onClick={() => setRecord(null)}>Cancel</Button><Button disabled={busy || !draft.warehouseId || Boolean(record?.restockedAt)} onClick={() => void save()}>Save receipt for inspection</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>
}
