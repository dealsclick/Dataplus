import { useEffect, useMemo, useState } from "react"
import { ArrowDown, ArrowUp, CheckCircle2, Loader2, Pencil, Plus, Save } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { api } from "../lib/client-api"
import { Field } from "./app-ui"

export type QuoteTermDefinition = {
  id: string
  group: string
  label: string
  text: string
  active: boolean
  defaultSelected: boolean
  exclusiveGroup: string
  sortOrder: number
  createdAt?: string
  updatedAt?: string
}

const emptyTerm = (): QuoteTermDefinition => ({
  id: `quote-term-${crypto.randomUUID()}`,
  group: "Commercial",
  label: "",
  text: "",
  active: true,
  defaultSelected: false,
  exclusiveGroup: "",
  sortOrder: 0,
})

function normalizedTerms(terms: QuoteTermDefinition[]) {
  return terms.map((term, index) => ({ ...term, sortOrder: index }))
}

export function QuoteTermsSettings({ canEdit }: { canEdit: boolean }) {
  const [terms, setTerms] = useState<QuoteTermDefinition[]>([])
  const [savedTerms, setSavedTerms] = useState<QuoteTermDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [companyOwned, setCompanyOwned] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [termDraft, setTermDraft] = useState<QuoteTermDefinition>(emptyTerm)
  const [dialogOpen, setDialogOpen] = useState(false)

  const dirty = JSON.stringify(terms) !== JSON.stringify(savedTerms)
  const activeTerms = useMemo(() => terms.filter((term) => term.active), [terms])
  const defaultTerms = activeTerms.filter((term) => term.defaultSelected)

  const load = async () => {
    setLoading(true)
    try {
      const result = await api<{ quoteTerms?: QuoteTermDefinition[]; companyOwned?: boolean }>("/api/quote-terms")
      const next = normalizedTerms(result.quoteTerms || [])
      setTerms(next)
      setSavedTerms(next)
      setCompanyOwned(result.companyOwned === true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load quote terms.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const updateTerm = (index: number, patch: Partial<QuoteTermDefinition>) => {
    setTerms((current) => {
      const source = current[index]
      if (!source) return current
      const nextTerm = { ...source, ...patch }
      if (patch.active === false) nextTerm.defaultSelected = false
      let next = current.map((term, termIndex) => termIndex === index ? nextTerm : term)
      if (nextTerm.defaultSelected && nextTerm.exclusiveGroup) {
        next = next.map((term, termIndex) => termIndex !== index && term.exclusiveGroup === nextTerm.exclusiveGroup ? { ...term, defaultSelected: false } : term)
      }
      return normalizedTerms(next)
    })
  }

  const moveTerm = (index: number, direction: -1 | 1) => {
    setTerms((current) => {
      const target = index + direction
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return normalizedTerms(next)
    })
  }

  const openCreate = () => {
    setEditingIndex(null)
    setTermDraft({ ...emptyTerm(), sortOrder: terms.length })
    setDialogOpen(true)
  }

  const openEdit = (index: number) => {
    setEditingIndex(index)
    setTermDraft({ ...terms[index] })
    setDialogOpen(true)
  }

  const applyDialog = () => {
    const label = termDraft.label.trim()
    const group = termDraft.group.trim()
    const text = termDraft.text.trim()
    if (!label || !group || !text) return toast.error("Enter a group, internal label, and customer-facing wording.")
    setTerms((current) => {
      const nextTerm = { ...termDraft, label, group, text, exclusiveGroup: termDraft.exclusiveGroup.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-") }
      let next = editingIndex === null ? [...current, nextTerm] : current.map((term, index) => index === editingIndex ? nextTerm : term)
      if (nextTerm.defaultSelected && nextTerm.exclusiveGroup) next = next.map((term) => term.id !== nextTerm.id && term.exclusiveGroup === nextTerm.exclusiveGroup ? { ...term, defaultSelected: false } : term)
      return normalizedTerms(next)
    })
    setDialogOpen(false)
  }

  const save = async () => {
    setSaving(true)
    try {
      const result = await api<{ quoteTerms?: QuoteTermDefinition[]; message?: string }>("/api/quote-terms", {
        method: "PUT",
        body: JSON.stringify({ quoteTerms: normalizedTerms(terms) }),
      })
      const next = normalizedTerms(result.quoteTerms || terms)
      setTerms(next)
      setSavedTerms(next)
      toast.success(result.message || "Quote terms saved.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save quote terms.")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="grid min-h-48 place-items-center"><Loader2 className="size-6 animate-spin text-primary" /></div>

  return <div className="grid gap-4">
    <Card>
      <CardHeader className="gap-3 border-b sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base">Quote terms library</CardTitle>
          <CardDescription>{companyOwned ? "These terms belong only to the selected company." : "These terms belong to LINQ USA dba Dealsclick."} New quotes use the defaults below; issued quotes keep their original wording.</CardDescription>
        </div>
        {canEdit ? <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" onClick={openCreate}><Plus className="size-4" /> Add term</Button>
          <Button disabled={!dirty || saving} onClick={() => void save()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save library</Button>
        </div> : null}
      </CardHeader>
      <CardContent className="grid gap-4 pt-5">
        {!canEdit ? <Alert><CheckCircle2 className="size-4" /><AlertTitle>Read-only access</AlertTitle><AlertDescription>An administrator with Sales settings access can change this company&apos;s quote terms.</AlertDescription></Alert> : null}
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="outline">{activeTerms.length} active</Badge>
          <Badge variant="outline">{defaultTerms.length} selected by default</Badge>
          {dirty ? <Badge className="bg-amber-500 text-black hover:bg-amber-500">Unsaved changes</Badge> : <Badge variant="secondary">Saved</Badge>}
        </div>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader><TableRow><TableHead className="w-20">Order</TableHead><TableHead className="w-32">Group</TableHead><TableHead className="min-w-44">Internal label</TableHead><TableHead className="min-w-[360px]">Customer wording</TableHead><TableHead className="w-28">Exclusive</TableHead><TableHead className="w-24 text-center">Default</TableHead><TableHead className="w-24 text-center">Active</TableHead><TableHead className="w-16" /></TableRow></TableHeader>
            <TableBody>{terms.map((term, index) => <TableRow key={term.id} className={!term.active ? "opacity-55" : undefined}>
              <TableCell><div className="flex gap-1"><Button type="button" title="Move up" aria-label={`Move ${term.label} up`} size="icon" variant="ghost" disabled={!canEdit || index === 0} onClick={() => moveTerm(index, -1)}><ArrowUp className="size-4" /></Button><Button type="button" title="Move down" aria-label={`Move ${term.label} down`} size="icon" variant="ghost" disabled={!canEdit || index === terms.length - 1} onClick={() => moveTerm(index, 1)}><ArrowDown className="size-4" /></Button></div></TableCell>
              <TableCell><Badge variant="outline">{term.group}</Badge></TableCell>
              <TableCell className="font-medium">{term.label}</TableCell>
              <TableCell className="whitespace-normal text-sm text-muted-foreground">{term.text}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{term.exclusiveGroup || "-"}</TableCell>
              <TableCell className="text-center"><Switch aria-label={`${term.label} selected by default`} disabled={!canEdit || !term.active} checked={term.defaultSelected} onCheckedChange={(checked) => updateTerm(index, { defaultSelected: checked })} /></TableCell>
              <TableCell className="text-center"><Switch aria-label={`${term.label} active`} disabled={!canEdit} checked={term.active} onCheckedChange={(checked) => updateTerm(index, { active: checked })} /></TableCell>
              <TableCell><Button type="button" title="Edit term" aria-label={`Edit ${term.label}`} size="icon" variant="ghost" disabled={!canEdit} onClick={() => openEdit(index)}><Pencil className="size-4" /></Button></TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle className="text-base">Default customer preview</CardTitle><CardDescription>This is the order and wording a salesperson starts with on a new quote.</CardDescription></CardHeader>
      <CardContent>{defaultTerms.length ? <ol className="grid gap-2 text-sm text-muted-foreground">{defaultTerms.map((term, index) => <li key={term.id} className="flex gap-3"><span className="w-5 shrink-0 text-right tabular-nums">{index + 1}.</span><span><span className="font-medium text-foreground">{term.label}:</span> {term.text}</span></li>)}</ol> : <p className="text-sm text-muted-foreground">No terms are selected by default. Salespeople can still choose active terms while editing a quote.</p>}</CardContent>
    </Card>

    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-2xl flex-col overflow-hidden p-0 sm:max-h-[90vh]">
        <DialogHeader className="border-b px-4 py-5 sm:px-6"><DialogTitle>{editingIndex === null ? "Add quote term" : "Edit quote term"}</DialogTitle><DialogDescription>Use a short internal label and complete customer-facing language. The term ID remains stable after it is created.</DialogDescription></DialogHeader>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-4 py-5 sm:px-6">
          <div className="grid gap-4 sm:grid-cols-2"><Field label="Group"><Input value={termDraft.group} onChange={(event) => setTermDraft((current) => ({ ...current, group: event.target.value }))} placeholder="Payment, Shipping, Returns..." /></Field><Field label="Internal label"><Input value={termDraft.label} onChange={(event) => setTermDraft((current) => ({ ...current, label: event.target.value }))} placeholder="Net 30" /></Field></div>
          <Field label="Customer-facing wording"><Textarea className="min-h-32" value={termDraft.text} onChange={(event) => setTermDraft((current) => ({ ...current, text: event.target.value }))} placeholder="Approved account payment is due within 30 days of the invoice date." /></Field>
          <Field label="Mutually exclusive group"><Input value={termDraft.exclusiveGroup} onChange={(event) => setTermDraft((current) => ({ ...current, exclusiveGroup: event.target.value }))} placeholder="Optional, for example payment" /><p className="text-xs text-muted-foreground">Terms with the same value cannot be selected together. Leave blank when terms may be combined.</p></Field>
          <div className="grid gap-3 rounded-md border p-4 sm:grid-cols-2"><label className="flex items-center justify-between gap-3 text-sm"><span><span className="block font-medium">Active</span><span className="block text-xs text-muted-foreground">Available to salespeople</span></span><Switch checked={termDraft.active} onCheckedChange={(checked) => setTermDraft((current) => ({ ...current, active: checked, defaultSelected: checked ? current.defaultSelected : false }))} /></label><label className="flex items-center justify-between gap-3 text-sm"><span><span className="block font-medium">Selected by default</span><span className="block text-xs text-muted-foreground">Starts checked on new quotes</span></span><Switch disabled={!termDraft.active} checked={termDraft.defaultSelected} onCheckedChange={(checked) => setTermDraft((current) => ({ ...current, defaultSelected: checked }))} /></label></div>
        </div>
        <DialogFooter className="border-t bg-background px-4 py-4 sm:px-6"><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button onClick={applyDialog}>{editingIndex === null ? "Add term" : "Apply changes"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
