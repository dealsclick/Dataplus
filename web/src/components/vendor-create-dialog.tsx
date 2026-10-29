import { type ReactNode, useEffect, useState } from "react"
import { Loader2, Plus } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { api } from "@/lib/client-api"
import type { Vendor } from "../App"

const emptyVendor = { name: "", code: "", contactName: "", email: "", phone: "", website: "", notes: "" }

function VendorField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid min-w-0 gap-2"><Label>{label}</Label>{children}</div>
}

export function VendorCreateDialog({
  open,
  onOpenChange,
  onCreated,
  context = "vendors",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (vendor: Vendor) => void | Promise<void>
  context?: "vendors" | "external-receipt"
}) {
  const [draft, setDraft] = useState(emptyVendor)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) setDraft(emptyVendor) }, [open])
  const update = (key: keyof typeof emptyVendor, value: string) => setDraft((current) => ({ ...current, [key]: value }))
  const save = async () => {
    if (!draft.name.trim() || saving) return
    setSaving(true)
    try {
      const result = await api<{ vendor: Vendor }>("/api/vendors", {
        method: "POST",
        body: JSON.stringify({ ...draft, name: draft.name.trim(), code: draft.code.trim() })
      })
      await onCreated(result.vendor)
      toast.success(`${result.vendor.name} was created as an inactive vendor.`)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to create the vendor.")
    } finally {
      setSaving(false)
    }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!saving) onOpenChange(next) }}>
    <DialogContent className="flex max-h-[100dvh] w-full flex-col overflow-hidden sm:max-h-[90dvh] sm:max-w-2xl">
      <DialogHeader><DialogTitle>Create vendor</DialogTitle><DialogDescription>{context === "external-receipt" ? "Create the supplier, select it for this external PO receipt, then complete its full profile later from Vendors." : "Create an inactive supplier profile. Catalog, purchasing automation, and feeds stay disabled until reviewed."}</DialogDescription></DialogHeader>
      <div className="grid min-h-0 gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
        <VendorField label="Vendor name"><Input autoFocus value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="Supplier legal or display name" /></VendorField>
        <VendorField label="Vendor code"><Input value={draft.code} onChange={(event) => update("code", event.target.value)} placeholder="Optional internal/source code" /></VendorField>
        <VendorField label="Contact name"><Input value={draft.contactName} onChange={(event) => update("contactName", event.target.value)} /></VendorField>
        <VendorField label="Email"><Input type="email" value={draft.email} onChange={(event) => update("email", event.target.value)} /></VendorField>
        <VendorField label="Phone"><Input value={draft.phone} onChange={(event) => update("phone", event.target.value)} /></VendorField>
        <VendorField label="Website"><Input type="url" value={draft.website} onChange={(event) => update("website", event.target.value)} placeholder="https://" /></VendorField>
        <div className="sm:col-span-2"><VendorField label="Notes"><Textarea rows={4} value={draft.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Account, transition, or receiving notes" /></VendorField></div>
      </div>
      <DialogFooter className="shrink-0 border-t pt-4"><Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={saving || !draft.name.trim()} onClick={() => void save()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Create vendor</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
