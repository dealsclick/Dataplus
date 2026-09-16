import { useEffect, useState } from 'react'
import { RefreshCw, Check } from 'lucide-react'
import { CategoryMappingWorkspace } from './category-mapping-workspace'
import { Button } from './ui/button'
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
  const [suggestion, setSuggestion] = useState<Json | null>(null)
  const [draft, setDraft] = useState<Json>({})
  const [status, setStatus] = useState<Json>({})
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
      .then(([data, info]) => { if (active) { setSaved(data.mapping); setSuggestion(data.suggestion || null); reset(data.mapping); setStatus(info) } })
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
  if (loading) return <p role="status" className="p-4 text-sm text-muted-foreground">Loading mapping...</p>
  const dirty = draft.productType !== saved?.productType || offer !== JSON.stringify(saved?.orderable || {}, null, 2) || content !== JSON.stringify(saved?.visible || {}, null, 2)
  return <CategoryMappingWorkspace channel="Walmart" localCategory={category} categoryId={draft.productType} categoryPath={draft.path || draft.productType || ""}
    review={<section aria-label="Suggested Walmart category" className="min-w-0 border-l-2 border-amber-500 bg-amber-500/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-semibold">Suggested category</h4>{suggestion?.confidence != null && <span className="text-xs">{Math.round(Number(suggestion.confidence) * 100)}% confidence</span>}</div>
      <p className="mt-2 text-sm [overflow-wrap:anywhere]">{suggestion?.categoryPath || suggestion?.categoryId || (suggestion ? 'No suggestion found' : 'No pending suggestion')}</p>
      {suggestion?.rationale && <p className="mt-2 text-xs text-muted-foreground">{suggestion.rationale}</p>}
      {suggestion && suggestion.warnings?.length > 0 && <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">{suggestion.warnings.join(' ')}</p>}
      {suggestion?.categoryId && <Button className="mt-3" size="sm" variant="outline" disabled={busy} onClick={() => { setDraft({ productType: suggestion.categoryId, path: suggestion.categoryPath }); setOffer('{}'); setContent('{}'); setSchema(null); setMessage('Suggestion selected. Save to approve this mapping.') }}><Check className="size-4" /> Use suggestion</Button>}
    </section>}
    dirty={dirty} busy={busy} query={query} onQuery={setQuery} onSearch={() => void run(() => search())}
    results={results.map(row => ({ id: row.productType, path: row.path || row.productType }))}
    onSelect={id => { const row = results.find(item => item.productType === id); if (!row) return; if (draft.productType !== row.productType) { setOffer('{}'); setContent('{}'); setSchema(null) } setDraft(row); setResults([]) }}
    onDiscard={() => reset(saved)}
    onSave={() => void run(async () => { const data = await request('mapping', { category, productType: draft.productType, orderable: parse(offer), visible: parse(content) }); setSaved(data.mapping); setSuggestion(null); reset(data.mapping); setMessage('Mapping saved.'); onSaved?.() })}
    status={message || (saved?.productType && saved?.updatedAt ? 'Saved ' + new Date(saved.updatedAt).toLocaleString() : 'No saved mapping')}
    notice={error ? <p role="alert" className="text-sm text-destructive">{error}</p> : <p className="text-xs text-muted-foreground">{Number(status.taxonomy?.count || 0).toLocaleString()} cached product types · Version {status.taxonomy?.version || 'Not downloaded'}</p>}
    pagination={total > 0 && <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground"><span>{total} matches</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy || !offset} onClick={() => void run(() => search(offset - 100))}>Previous</Button><Button size="sm" variant="outline" disabled={busy || offset + 100 >= total} onClick={() => void run(() => search(offset + 100))}>Next</Button></div></div>}>
      <section className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">Category requirements</h3><Button size="sm" variant="outline" disabled={busy || !draft.productType} onClick={() => void run(async () => { setSchema((await request('spec', { productType: draft.productType })).schema) })}><RefreshCw className="size-4" /> Refresh requirements</Button></div>
        <p className="text-xs text-muted-foreground">Use only verified defaults. Required attributes are validated again for each product during launch preview.</p>
        {schema && (() => {
          const properties = walmartSchemaNode(schema, walmartSchemaNode(schema, schema.properties?.MPItem).items).properties || {}
          let offerValue: Json, contentValue: Json
          try { offerValue = parse(offer); contentValue = parse(content) } catch { return <p className="text-sm text-destructive">Correct the advanced JSON before editing attributes.</p> }
          return <div className="grid min-w-0 gap-4 xl:grid-cols-2"><div className="min-w-0"><h4 className="mb-2 text-sm font-medium">Offer attributes</h4><WalmartAttributes root={schema} schema={properties.Orderable || {}} value={offerValue} offer onChange={value => setOffer(JSON.stringify(value, null, 2))} /></div><div className="min-w-0"><h4 className="mb-2 text-sm font-medium">Product attributes</h4><WalmartAttributes root={schema} schema={walmartSchemaNode(schema, properties.Visible).properties?.[draft.productType] || {}} value={contentValue} onChange={value => setContent(JSON.stringify(value, null, 2))} /></div></div>
        })()}
        <details><summary className="cursor-pointer text-sm">Advanced defaults (JSON)</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="grid gap-2 text-sm">Offer defaults<Textarea value={offer} onChange={event => setOffer(event.target.value)} /></label><label className="grid gap-2 text-sm">Product defaults<Textarea value={content} onChange={event => setContent(event.target.value)} /></label></div></details>
      </section>
  </CategoryMappingWorkspace>
}
