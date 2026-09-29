import { useMemo, useState } from "react"
import { Bold, Italic, List, Plus, Trash2 } from "lucide-react"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"

type Template = { id: string; name: string; type: string; subject: string; content: string; builtIn?: boolean }
type Settings = Record<string, unknown>

const assignments = [
  ["customerPaidRma", "Customer-paid RMA"],
  ["prepaidRma", "Prepaid-label RMA"],
  ["managerReview", "Manager review notice"],
  ["denied", "Return denied"],
  ["received", "Return received"],
  ["refunded", "Refund completed"],
  ["vendorReturn", "Vendor return request"],
] as const

export function ReturnTemplateSettings({ settings, editing, onChange }: { settings: Settings; editing: boolean; onChange: (field: string, value: unknown) => void }) {
  const templates = (Array.isArray(settings.returnTemplates) ? settings.returnTemplates : []) as Template[]
  const selectedAssignments = (settings.returnTemplateAssignments && typeof settings.returnTemplateAssignments === "object" ? settings.returnTemplateAssignments : {}) as Record<string, string>
  const [selectedId, setSelectedId] = useState(templates[0]?.id || "")
  const selected = useMemo(() => templates.find((template) => template.id === selectedId) || templates[0], [templates, selectedId])
  const updateTemplate = (patch: Partial<Template>) => {
    if (!selected) return
    onChange("returnTemplates", templates.map((template) => template.id === selected.id ? { ...template, ...patch } : template))
  }
  const addTemplate = () => {
    const id = `return-template-${Date.now()}`
    onChange("returnTemplates", [...templates, { id, name: "New return template", type: "email", subject: "Return update for {{order_number}}", content: "<p>Write the customer or vendor message here.</p>" }])
    setSelectedId(id)
  }
  const removeTemplate = () => {
    if (!selected || selected.builtIn) return
    onChange("returnTemplates", templates.filter((template) => template.id !== selected.id))
    setSelectedId(templates.find((template) => template.id !== selected.id)?.id || "")
  }
  const command = (name: "bold" | "italic" | "insertUnorderedList") => {
    document.execCommand(name)
  }
  return <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
    <Card className="min-w-0"><CardHeader><CardTitle className="text-base">Return templates</CardTitle><CardDescription>Reusable RMA, email, and vendor-return messages.</CardDescription></CardHeader><CardContent className="grid gap-2"><Button type="button" variant="outline" disabled={!editing} onClick={addTemplate}><Plus className="size-4" /> Add template</Button>{templates.map((template) => <button key={template.id} type="button" onClick={() => setSelectedId(template.id)} className={`rounded-md border p-3 text-left ${selected?.id === template.id ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}><span className="block truncate text-sm font-medium">{template.name}</span><span className="block text-xs text-muted-foreground">{template.type.replace(/_/g, " ")}{template.builtIn ? " / System" : ""}</span></button>)}</CardContent></Card>
    <div className="grid min-w-0 gap-4">
      <Card><CardHeader><CardTitle className="text-base">Policy and assignments</CardTitle><CardDescription>Set the customer-fault fee default and choose the template for every return event. The fee remains editable on each RMA.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"><div className="grid gap-2"><Label>Default customer restocking fee</Label><div className="relative"><Input className="pr-9" disabled={!editing} type="number" min="0" max="100" step="0.1" value={String(Number(settings.returnDefaultCustomerRestockingPercent ?? 30))} onChange={(event) => onChange("returnDefaultCustomerRestockingPercent", Math.max(0, Math.min(100, Number(event.target.value || 0))))} /><span className="pointer-events-none absolute right-3 top-2.5 text-sm text-muted-foreground">%</span></div></div>{assignments.map(([key, label]) => <div key={key} className="grid min-w-0 gap-2"><Label>{label}</Label><Select disabled={!editing} value={selectedAssignments[key] || "none"} onValueChange={(value) => onChange("returnTemplateAssignments", { ...selectedAssignments, [key]: value === "none" ? "" : value })}><SelectTrigger className="min-w-0"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Not assigned</SelectItem>{templates.map((template) => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent></Select></div>)}</CardContent></Card>
      <Card><CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-base">Template editor</CardTitle><CardDescription>Available fields: {"{{rma_number}}"}, {"{{order_number}}"}, {"{{customer_name}}"}, {"{{return_warehouse}}"}, {"{{po_number}}"}, and {"{{vendor_return_number}}"}.</CardDescription></div><Button type="button" size="sm" variant="outline" disabled={!editing || !selected || selected.builtIn} onClick={removeTemplate}><Trash2 className="size-4" /> Delete</Button></div></CardHeader><CardContent>{selected ? <div className="grid gap-4"><div className="grid gap-4 sm:grid-cols-2"><div className="grid gap-2"><Label>Name</Label><Input disabled={!editing} value={selected.name} onChange={(event) => updateTemplate({ name: event.target.value })} /></div><div className="grid gap-2"><Label>Type</Label><Select disabled={!editing} value={selected.type} onValueChange={(type) => updateTemplate({ type })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="rma">RMA document</SelectItem><SelectItem value="email">Customer email</SelectItem><SelectItem value="vendor_return">Vendor return</SelectItem></SelectContent></Select></div></div><div className="grid gap-2"><Label>Subject or document title</Label><Input disabled={!editing} value={selected.subject} onChange={(event) => updateTemplate({ subject: event.target.value })} /></div><div className="grid gap-2"><Label>Message</Label><div className="flex gap-1 rounded-t-md border border-b-0 bg-muted/30 p-1"><Button type="button" size="icon" variant="ghost" disabled={!editing} title="Bold" onMouseDown={(event) => event.preventDefault()} onClick={() => command("bold")}><Bold className="size-4" /></Button><Button type="button" size="icon" variant="ghost" disabled={!editing} title="Italic" onMouseDown={(event) => event.preventDefault()} onClick={() => command("italic")}><Italic className="size-4" /></Button><Button type="button" size="icon" variant="ghost" disabled={!editing} title="Bulleted list" onMouseDown={(event) => event.preventDefault()} onClick={() => command("insertUnorderedList")}><List className="size-4" /></Button></div><div key={selected.id} className="min-h-48 rounded-b-md border bg-background p-3 text-sm outline-none focus:ring-2 focus:ring-ring" contentEditable={editing} suppressContentEditableWarning dangerouslySetInnerHTML={{ __html: selected.content }} onInput={(event) => updateTemplate({ content: event.currentTarget.innerHTML })} /></div></div> : <p className="text-sm text-muted-foreground">Choose a template to edit.</p>}</CardContent></Card>
    </div>
  </div>
}
