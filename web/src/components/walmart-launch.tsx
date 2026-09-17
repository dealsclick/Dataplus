import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'
import { Badge } from './ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog'

type Json = Record<string, any>
async function api(path: string, body: Json, signal?: AbortSignal) {
  const response = await fetch(`/api/walmart/${path}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Walmart request failed')
  return data
}
const labelFor = (key: string) => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, first => first.toUpperCase())
// Present every branch's fields; server-side draft-07 validation decides which conditions apply.
function expanded(schema: Json, root: Json, depth = 0): Json {
  if (!schema || depth > 12) return {}
  const ref = schema.$ref?.startsWith('#/') ? schema.$ref.slice(2).split('/').reduce((value: any, key: string) => value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], root) : null
  const base = ref ? { ...expanded(ref, root, depth + 1), ...schema } : { ...schema }
  const properties = { ...(base.properties || {}) }
  for (const part of [...(base.allOf || []), ...(base.anyOf || []), ...(base.oneOf || []), base.then, base.else, ...Object.values(base.dependencies || {}).filter(value => !Array.isArray(value))].filter(Boolean)) Object.assign(properties, expanded(part, root, depth + 1).properties || {})
  return { ...base, properties, required: [...new Set([...(base.required || []), ...(base.allOf || []).flatMap((part: Json) => expanded(part, root, depth + 1).required || [])])] }
}
function Field({ name, schema, root, value, change, required = false, depth = 0 }: { name: string; schema: Json; root: Json; value: any; change: (value: any) => void; required?: boolean; depth?: number }) {
  const s = expanded(schema, root)
  const title = s.title || labelFor(name)
  const caption = <span className="break-words font-medium">{title}{required && <span className="ml-1 text-destructive">*</span>}</span>
  if (depth > 10) return <p className="text-sm text-destructive">{title}: nested requirements could not be displayed.</p>
  if (s.type === 'array' || Array.isArray(value)) {
    const rows = Array.isArray(value) ? value : []
    return <fieldset className="min-w-0 space-y-2 rounded border p-3"><legend className="px-1 text-sm">{caption}</legend>{s.description && <p className="text-xs text-muted-foreground">{s.description}</p>}{rows.map((entry: any, i: number) => <div key={i} className="min-w-0 space-y-2 rounded border p-2"><Field name={`${title} ${i + 1}`} schema={Array.isArray(s.items) ? s.items[i] || {} : s.items || {}} root={root} value={entry} change={next => change(rows.map((row, j) => j === i ? next : row))} depth={depth + 1} /><Button size="sm" variant="outline" onClick={() => change(rows.filter((_, j) => j !== i))}>Remove {i + 1}</Button></div>)}<Button size="sm" variant="outline" disabled={s.maxItems !== undefined && rows.length >= s.maxItems} onClick={() => change([...rows, s.items?.type === 'object' || s.items?.properties ? {} : ''])}>Add {title}</Button></fieldset>
  }
  if (s.type === 'object' || Object.keys(s.properties || {}).length || value && typeof value === 'object') {
    const data = value && typeof value === 'object' ? value : {}
    const keys = [...new Set([...Object.keys(s.properties || {}), ...Object.keys(data)])].filter(key => !['__proto__', 'constructor', 'prototype'].includes(key))
    const contents = <div className="grid min-w-0 gap-3">{keys.sort((a, b) => Number(s.required?.includes(b) || false) - Number(s.required?.includes(a) || false)).map(key => <Field key={key} name={key} schema={s.properties?.[key] || {}} root={root} value={data[key]} required={s.required?.includes(key)} depth={depth + 1} change={next => { const updated = { ...data }; if (next === undefined) delete updated[key]; else updated[key] = next; change(updated) }} />)}{!keys.length && <p className="text-xs text-muted-foreground">No fields specified for this section.</p>}</div>
    return <details className="min-w-0 rounded border p-3" open={required || depth === 0 || Object.keys(data).length > 0}><summary className="cursor-pointer text-sm">{caption}</summary><div className="mt-3">{contents}</div></details>
  }
  return <label className="grid min-w-0 gap-1 text-sm">{caption}{s.enum ? <select className="h-9 w-full min-w-0 rounded-md border bg-background px-2" value={value === undefined ? '' : JSON.stringify(value)} onChange={e => change(e.target.value ? JSON.parse(e.target.value) : undefined)}><option value="">Choose…</option>{s.enum.map((option: any) => <option key={JSON.stringify(option)} value={JSON.stringify(option)}>{String(option)}</option>)}</select> : s.type === 'boolean' ? <select className="h-9 rounded-md border bg-background px-2" value={value === undefined ? '' : String(value)} onChange={e => change(e.target.value === '' ? undefined : e.target.value === 'true')}><option value="">Choose…</option><option value="true">Yes</option><option value="false">No</option></select> : s.type === 'number' || s.type === 'integer' ? <Input type="number" step={s.type === 'integer' ? '1' : 'any'} value={value ?? ''} min={s.minimum} max={s.maximum} onChange={e => change(e.target.value === '' ? undefined : Number(e.target.value))} /> : (s.maxLength > 250 || /description/i.test(name)) ? <Textarea value={value ?? ''} maxLength={s.maxLength} onChange={e => change(e.target.value || undefined)} /> : <Input value={value ?? ''} maxLength={s.maxLength} onChange={e => change(e.target.value || undefined)} />}{s.description && <span className="break-words text-xs text-muted-foreground">{s.description}</span>}</label>
}

export function WalmartLaunch({ sku, open, onOpenChange }: { sku: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [form, setForm] = useState<Json | null>(null), [offer, setOffer] = useState<Json>({}), [content, setContent] = useState<Json>({})
  const [price, setPrice] = useState(''), [pack, setPack] = useState(false), [preview, setPreview] = useState<Json | null>(null)
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(''), [submitted, setSubmitted] = useState<Json | null>(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setLoading(true); setError(''); setForm(null); setPreview(null); setSubmitted(null); setPack(false)
    void api('launch/form', { sku }, controller.signal).then(data => {
      if (controller.signal.aborted) return
      setForm(data); setPrice(String(data.price)); setOffer(data.payload.MPItem[0][data.feedType === 'MP_ITEM_MATCH' ? 'Item' : 'Orderable'] || {}); setContent(data.payload.MPItem[0].Visible?.[data.productType] || {})
    }).catch(err => { if (!controller.signal.aborted) setError(err.message) }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [open, sku, reload])
  function edited() { setPreview(null); setError('') }
  async function review() {
    setBusy(true); setError(''); setPreview(null)
    try { setPreview(await api('launch/preview', { sku, price: Number(price), orderable: offer, visible: content, confirmIdentifierPack: pack })) }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to review item') }
    finally { setBusy(false) }
  }
  async function submit() {
    if (!preview) return
    setBusy(true); setError('')
    try { setSubmitted(await api('launch/apply', { tokens: [preview.token] })); setPreview(null) }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to submit item') }
    finally { setBusy(false) }
  }
  const root = form?.schema || {}, itemSchema = expanded(expanded(root, root).properties?.MPItem || {}, root).items || {}
  const item = expanded(itemSchema, root), offerSchema = expanded(item.properties?.[form?.feedType === 'MP_ITEM_MATCH' ? 'Item' : 'Orderable'] || {}, root)
  const hidden = ['sku', 'price', 'productIdentifiers', 'specProductType', 'quantity', 'inventory']
  const editableSchema = { ...offerSchema, properties: Object.fromEntries(Object.entries(offerSchema.properties || {}).filter(([key]) => !hidden.includes(key))) }
  const editableOffer = Object.fromEntries(Object.entries(offer).filter(([key]) => !hidden.includes(key)))
  const visibleSchema = expanded(item.properties?.Visible || {}, root).properties?.[form?.productType] || {}
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value) }}><DialogContent className="flex max-h-[90dvh] w-[calc(100%_-_1rem)] flex-col overflow-hidden sm:max-w-3xl"><DialogHeader className="min-w-0 shrink-0 pr-6"><DialogTitle>Launch on Walmart</DialogTitle><DialogDescription>Complete the Walmart fields for this product, review the price and requirements, then submit.</DialogDescription></DialogHeader>
    <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto">
      {loading && <p role="status" className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />Loading Walmart requirements…</p>}
      {error && <div role="alert" className="space-y-2 rounded border border-destructive p-3 text-sm"><p>{error}</p>{!form && <Button size="sm" variant="outline" onClick={() => setReload(x => x + 1)}>Retry loading requirements</Button>}</div>}
      {submitted ? <div role="status" className="rounded border p-3"><p>{submitted.message || 'Launch queued for submission.'}</p><a className="underline" href="/jobs">View job {submitted.job?.jobNumber || submitted.job?.id}</a><p className="mt-2 text-sm text-muted-foreground">The worker submits the reviewed item. Walmart processing and live publication are separate steps.</p></div> : form && <fieldset disabled={busy} className="min-w-0 space-y-4">
        <div className="flex flex-wrap gap-2"><Badge variant="outline">{form.environment}</Badge><Badge variant="secondary">{form.feedType === 'MP_ITEM_MATCH' ? 'Existing Walmart item' : form.productType}</Badge></div>
        <p className="break-words text-sm font-medium">{form.title}</p>
        {form.feedType === 'MP_ITEM_MATCH' && <p className="rounded border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">Launch against the existing Walmart catalog item. Walmart supplies its category; a local Walmart category mapping is not required for this offer.</p>}
        <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm">Seller SKU<Input value={form.sku} readOnly /><span className="text-xs text-muted-foreground">Uses this product’s DataPlus SKU to preserve linking.</span></label><label className="grid gap-1 text-sm">{form.identifier.kind.toUpperCase()}<Input readOnly value={form.identifier.value} /></label><label className="grid gap-1 text-sm">Walmart price (USD) *<Input type="number" min={form.minimumPrice} step="0.01" value={price} onChange={e => { setPrice(e.target.value); edited() }} /><span className="text-xs text-muted-foreground">Minimum ${form.minimumPrice.toFixed(2)} under current channel rules.</span></label></div>
        {form.packSize > 1 && <label className="flex items-start gap-2 rounded border p-3 text-sm"><input type="checkbox" checked={pack} onChange={e => { setPack(e.target.checked); edited() }} />I confirm this identifier represents the exact selling pack of {form.packSize} units.</label>}
        <p className="text-xs text-muted-foreground">Fields below come from Walmart’s requirements. Conditional fields may apply based on your answers; Review checks the complete item. No positive inventory is sent during launch.</p>
        <Field name="Offer details" schema={editableSchema} root={root} value={editableOffer} change={next => { setOffer(next); edited() }} required />
        {form.feedType === 'MP_ITEM' && <Field name="Product attributes" schema={visibleSchema} root={root} value={content} change={next => { setContent(next); edited() }} required />}
        {preview && <div role="status" className="space-y-2 rounded border p-3 text-sm"><Badge variant={preview.errors.length ? 'destructive' : 'secondary'}>{preview.errors.length ? 'Needs corrections' : 'Ready to submit'}</Badge><p>{preview.sku} · ${preview.price.toFixed(2)} · {preview.environment}</p>{preview.errors.map((row: Json, i: number) => <p className="break-words text-destructive" key={i}>{row.field}: {row.message}</p>)}{!preview.errors.length && <p>Submitting authorizes Walmart to process and potentially publish this offer at the reviewed price.</p>}</div>}
      </fieldset>}
    </div><DialogFooter className="shrink-0 gap-2"><Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Close</Button>{form && !submitted && (preview && !preview.errors.length ? <Button disabled={busy} onClick={() => void submit()}>{busy ? 'Submitting…' : 'Submit reviewed item'}</Button> : <Button disabled={busy || loading || !price || (form.packSize > 1 && !pack)} onClick={() => void review()}>{busy ? 'Checking requirements…' : 'Review launch'}</Button>)}</DialogFooter>
  </DialogContent></Dialog>
}
