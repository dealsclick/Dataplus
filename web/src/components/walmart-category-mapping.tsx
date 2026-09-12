import { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import { Textarea } from './ui/textarea'
import { WalmartAttributes, walmartSchemaNode } from './walmart-attributes'

type Json = Record<string, any>
async function request(path: string, body?: Json) {
  const response = await fetch(`/api/walmart/${path}`, { credentials: 'same-origin', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Walmart request failed')
  return data
}

export function WalmartCategoryMapping({ category, onSaved }: { category: string; onSaved?: () => void }) {
  const [saved, setSaved] = useState<Json | null>(null)
  const [draft, setDraft] = useState<Json>({})
  const [status, setStatus] = useState<Json>({})
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState(category.split(' > ').pop() || category)
  const [results, setResults] = useState<Json[]>([])
  const [offset, setOffset] = useState(0)
  const [total, setTotal] = useState(0)
  const [schema, setSchema] = useState<Json | null>(null)
  const [offer, setOffer] = useState('{}')
  const [content, setContent] = useState('{}')

  const reset = (mapping: Json | null) => {
    setDraft(mapping || {}); setOffer(JSON.stringify(mapping?.orderable || {}, null, 2)); setContent(JSON.stringify(mapping?.visible || {}, null, 2)); setSchema(null); setResults([])
  }
  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([request(`mapping?category=${encodeURIComponent(category)}`), request('status')])
      .then(([data, info]) => { if (active) { setSaved(data.mapping); reset(data.mapping); setStatus(info) } })
      .catch(error => { if (active) setError(error.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [category])

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('')
    try { await fn() } catch (error) { setError(error instanceof Error ? error.message : 'Request failed') } finally { setBusy(false) }
  }
  async function search(nextOffset = 0) {
    const data = await request(`taxonomy?q=${encodeURIComponent(query)}&offset=${nextOffset}`)
    setResults(data.rows); setOffset(nextOffset); setTotal(data.total)
  }
  function parse(text: string) {
    const data = JSON.parse(text)
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Attribute defaults must be a JSON object.')
    return data
  }
  if (loading) return <p className="p-4 text-sm text-muted-foreground">Loading saved Walmart mapping…</p>
  return <div className="grid min-w-0 gap-4">
    {error && <p role="alert" className="rounded border border-red-400 bg-red-500/5 p-3 text-sm break-words">{error}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    <section className="rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">Walmart category mapping</h3><Badge variant={saved ? 'secondary' : 'outline'}>{saved ? 'Mapped' : 'Not mapped'}</Badge></div>
      <p className="mt-2 break-words text-sm font-medium">{saved?.path || 'Choose a Walmart product type for this DataPlus category.'}</p>
      {saved && <p className="mt-1 text-xs text-muted-foreground">Product type: {saved.productType} · Version {saved.version} · Saved {new Date(saved.updatedAt).toLocaleString()}</p>}
      <p className="mt-2 text-xs text-muted-foreground">This is the same mapping used by Walmart setup and catalog launch. Saving applies to future launch previews; it does not publish or change live listings.</p>
      {!editing && <Button className="mt-3" variant="outline" disabled={busy} onClick={() => { reset(saved); setEditing(true) }}>{saved ? 'Edit Walmart mapping' : 'Map Walmart category'}</Button>}
    </section>
    {editing && <>
      <section className="grid min-w-0 gap-3 rounded-md border p-4">
        <h3 className="text-sm font-medium">Search cached Walmart categories</h3>
        <p className="text-xs text-muted-foreground">{Number(status.taxonomy?.count || 0).toLocaleString()} product types cached · Version {status.taxonomy?.version || 'Not downloaded'}. <a className="underline" href="/channels?channel=Walmart">Manage category downloads in Walmart setup</a>.</p>
        <div className="flex gap-2"><Input aria-label="Search cached Walmart categories" className="min-w-0" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void run(() => search()) }} /><Button variant="outline" disabled={busy} onClick={() => void run(() => search())}>Search</Button></div>
        <div className="max-h-64 overflow-auto">{results.map(row => <Button className="h-auto w-full justify-start whitespace-normal break-words text-left" variant={draft.productType === row.productType ? 'secondary' : 'ghost'} key={row.path} onClick={() => { if (draft.productType !== row.productType) { setOffer('{}'); setContent('{}'); setSchema(null) } setDraft(row) }}>{row.path}</Button>)}</div>
        <div className="flex flex-wrap gap-2 text-sm"><span>{total} matches</span><Button size="sm" variant="outline" disabled={busy || !offset} onClick={() => void run(() => search(offset - 100))}>Previous</Button><Button size="sm" variant="outline" disabled={busy || offset + 100 >= total} onClick={() => void run(() => search(offset + 100))}>More</Button></div>
        <p className="break-words text-sm">Selected: <strong>{draft.path || draft.productType || 'None'}</strong></p>
      </section>
      <section className="grid min-w-0 gap-3 rounded-md border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">Walmart item requirements</h3><Button size="sm" variant="outline" disabled={busy || !draft.productType} onClick={() => void run(async () => { setSchema((await request('spec', { productType: draft.productType })).schema) })}>Load required attributes</Button></div>
        <p className="text-xs text-muted-foreground">Use only verified defaults. Required attributes are validated again for each product during launch preview.</p>
        {schema && (() => {
          const properties = walmartSchemaNode(schema, walmartSchemaNode(schema, schema.properties?.MPItem).items).properties || {}
          let offerValue: Json, contentValue: Json
          try { offerValue = parse(offer); contentValue = parse(content) } catch { return <p className="text-sm text-destructive">Correct the advanced JSON before editing attributes.</p> }
          return <div className="grid min-w-0 gap-4 xl:grid-cols-2"><div className="min-w-0"><h4 className="mb-2 text-sm font-medium">Offer attributes</h4><WalmartAttributes root={schema} schema={properties.Orderable || {}} value={offerValue} offer onChange={value => setOffer(JSON.stringify(value, null, 2))} /></div><div className="min-w-0"><h4 className="mb-2 text-sm font-medium">Product attributes</h4><WalmartAttributes root={schema} schema={walmartSchemaNode(schema, properties.Visible).properties?.[draft.productType] || {}} value={contentValue} onChange={value => setContent(JSON.stringify(value, null, 2))} /></div></div>
        })()}
        <details><summary className="cursor-pointer text-sm">Advanced defaults (JSON)</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="grid gap-2 text-sm">Offer defaults<Textarea value={offer} onChange={event => setOffer(event.target.value)} /></label><label className="grid gap-2 text-sm">Product defaults<Textarea value={content} onChange={event => setContent(event.target.value)} /></label></div></details>
      </section>
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => { reset(saved); setEditing(false) }}>Cancel</Button><Button disabled={busy || !draft.productType} onClick={() => void run(async () => { const data = await request('mapping', { category, productType: draft.productType, orderable: parse(offer), visible: parse(content) }); setSaved(data.mapping); reset(data.mapping); setEditing(false); setMessage('Walmart mapping saved. It is now available in Categories, channel setup and catalog launch.'); onSaved?.() })}>Save Walmart mapping</Button></div>
    </>}
  </div>
}
