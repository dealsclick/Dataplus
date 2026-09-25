import { useEffect, useState } from 'react'
import { WalmartLaunch } from './walmart-launch'
import { Search, Loader2, CircleCheck, ExternalLink } from 'lucide-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog'

type ReadinessState = { status: string; errors: Array<{ field: string; message: string }> }
type WalmartCandidate = { candidateKey: string; itemId?: string; wpid?: string; title?: string; brand?: string; productType?: string; imageUrl?: string; productUrl?: string }
type MatchRow = { itemId?: string; productUrl?: string; referenceStatus?: string; referenceMessage?: string; candidates?: WalmartCandidate[]; selectedCandidate?: WalmartCandidate | null; existingOffer?: ReadinessState; newItem?: ReadinessState; checkedAt?: string; stale?: boolean; localOnly?: boolean; sku: string; title?: string; identifier?: { kind: string; value: string }; status: string; productType?: string; error?: string; packReviewRequired?: boolean }
type Batch = { rows: MatchRow[]; total: number; processed?: number; matchedCount?: number; remoteChecked?: number; cacheHits?: number; remotePending?: number; locallyBlocked?: number; complete: boolean; status: string; message?: string; jobNumber?: number }
async function request(path: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/walmart/${path}`, { credentials: 'same-origin', signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Walmart lookup failed')
  return result
}
export function WalmartUpcMatch({ skus, selectionRequest, open, onOpenChange, readiness = false }: { readiness?: boolean; skus: string[]; selectionRequest?: { allFiltered: true; query: string; filters: Record<string, string>; count: number }; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [jobId, setJobId] = useState('')
  const [launchSku, setLaunchSku] = useState('')
  const [batch, setBatch] = useState<Batch | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [offset, setOffset] = useState(0)
  const selection = JSON.stringify([skus, selectionRequest, readiness])
  useEffect(() => { setLaunchSku(''); setJobId(''); setBatch(null); setError(''); setOffset(0) }, [selection])
  useEffect(() => {
    if (!open || !jobId) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const result = await request(`match?jobId=${encodeURIComponent(jobId)}&offset=${offset}`, undefined, controller.signal)
        if (controller.signal.aborted) return
        setBatch(result); setError('')
        if (!result.complete && ['queued', 'running', 'stopping'].includes(result.status)) timer = setTimeout(poll, 3000)
      } catch (err) { if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : 'Unable to load results'); timer = setTimeout(poll, 10000) } }
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [open, jobId, offset])
  async function start() {
    setBusy(true); setError('')
    try {
      const single = skus.length === 1 && !selectionRequest
      const result = await request(single ? 'match/single' : 'match', single ? { sku: skus[0], readiness } : { skus, ...selectionRequest, readiness })
      setOffset(0)
      if (single) { setJobId(''); setBatch(result) }
      else { setJobId(result.job.id); setBatch({ rows: [], total: selectionRequest?.count ?? skus.length, complete: false, status: result.job.status, jobNumber: result.job.jobNumber, message: result.message }) }
    }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to match on Walmart') }
    finally { setBusy(false) }
  }
  const matched = batch?.rows.filter(row => row.status === 'matched').map(row => row.sku) || []
  const active = batch && ['queued', 'running', 'stopping'].includes(batch.status) && !batch.complete
  return <><Dialog open={open && !launchSku} onOpenChange={value => { if (!busy) onOpenChange(value) }}><DialogContent className="flex max-h-[90dvh] w-[calc(100%_-_1rem)] flex-col overflow-hidden sm:max-w-3xl">
    <DialogHeader className="min-w-0 shrink-0 pr-6"><DialogTitle>{readiness ? 'Check Walmart readiness' : 'Match on Walmart by UPC'}</DialogTitle><DialogDescription>Search Walmart US for {selectionRequest?.count ?? skus.length} selected catalog item{(selectionRequest?.count ?? skus.length) === 1 ? '' : 's'} using saved UPC, EAN or GTIN. Matching does not create a listing or link a seller SKU. {readiness && "Both existing-offer and new-item requirements are checked. Results expire after 24 hours; launch always rechecks requirements."}</DialogDescription></DialogHeader>
    <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto">
      {error && <p role="alert" className="rounded border border-destructive p-3 text-sm text-destructive">{error}</p>}
      {!batch && <p className="break-words rounded-md border bg-muted/30 p-3 text-sm">{selectionRequest ? `All ${selectionRequest.count.toLocaleString()} filtered products. Filters are evaluated when the job stages its selection.` : skus.length === 1 ? 'One product: lookup runs immediately, without waiting for a background job.' : `${skus.length.toLocaleString()} selected records. Products are processed in background batches.`}</p>}
      {!batch && readiness && (selectionRequest?.count || skus.length) > 5000 && <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">Large readiness runs screen every selected SKU locally, but make at most 5,000 new Walmart catalog lookups. Cached identifiers are reused. Narrow the filters and run readiness again for records left as Remote check pending.</p>}
      {batch && <div role="status" className="flex flex-wrap items-center gap-2 text-sm"><Badge variant="outline">{batch.status}</Badge><span>{batch.processed ?? batch.rows.length} / {batch.total} checked · {batch.matchedCount ?? matched.length} matched</span>{jobId && <a className="underline" href="/jobs">Job {batch.jobNumber || jobId}</a>}{batch.message && <p className="w-full text-muted-foreground">{batch.message}</p>}{batch.status === 'queued' && <p className="w-full text-muted-foreground">Waiting for the external worker. Results appear here as items are checked.</p>}</div>}
      {batch?.rows.map(row => <div key={row.sku} className="grid min-w-0 gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0"><p className="flex items-start gap-2 break-words font-semibold">{row.status === 'matched' && <CircleCheck className="size-5 shrink-0 text-emerald-600" aria-hidden="true" />}{row.sku}</p><p className="break-words text-sm text-muted-foreground">{row.title}</p><p className="text-xs">{row.identifier && `${row.identifier.kind.toUpperCase()}: ${row.identifier.value}`}</p><p className="mt-1 break-words text-sm">{row.error || (row.status === 'matched' ? 'Existing Walmart catalog item found — offer setup available.' : row.status === 'ambiguous' ? 'Multiple Walmart items use this identifier. Open the product Walmart tab to select the correct one.' : row.status === 'full_setup' ? 'Walmart returned item data; full item setup is required.' : row.status === 'remote_pending' ? 'Local checks passed. A narrower run is required for the Walmart catalog lookup.' : row.status === 'blocked' && row.localOnly ? 'Blocked by local catalog, supplier, pricing, or shipping rules; Walmart was not called.' : 'No match returned — review category mapping for full item setup.')}</p><WalmartCatalogReference row={row} /><WalmartReadinessResults row={row} />{row.packReviewRequired && <p className="text-sm text-amber-700 dark:text-amber-400">Confirm that the identifier represents this selling pack during launch review.</p>}</div>
        {!['error', 'ambiguous'].includes(row.status) && <Button size="sm" variant="outline" onClick={() => setLaunchSku(row.sku)}>Review launch</Button>}
      </div>)}
      {batch && batch.total > 100 && <div className="flex flex-wrap items-center gap-2 text-sm"><Button size="sm" variant="outline" disabled={!offset} onClick={() => setOffset(value => Math.max(0, value - 100))}>Previous results</Button><span>Results {offset + 1}–{offset + batch.rows.length}</span><Button size="sm" variant="outline" disabled={offset + 100 >= (batch.processed || 0)} onClick={() => setOffset(value => value + 100)}>Next results</Button><span className="text-muted-foreground">Full results are downloadable from Jobs.</span></div>}
    </div>
    <DialogFooter className="shrink-0 gap-2 border-t pt-3"><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>{matched.length > 1 && batch?.complete && <Button variant="outline" asChild><a href={`/products?action=walmart-launch&skus=${encodeURIComponent(matched.join('\n'))}`}>Review {matched.length} shown matched item{matched.length === 1 ? '' : 's'}</a></Button>}<Button disabled={busy || Boolean(active) || (skus.length < 1 && !selectionRequest)} onClick={() => void start()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}{busy ? 'Checking Walmart…' : readiness ? 'Check readiness' : batch ? 'Match again' : 'Match on Walmart by UPC'}</Button></DialogFooter>
  </DialogContent></Dialog><WalmartLaunch sku={launchSku} open={Boolean(launchSku) && open} onOpenChange={value => { if (!value) setLaunchSku('') }} /></>
}

export function WalmartReadinessResults({ row }: { row: Partial<MatchRow> }) {
  if (!row.existingOffer && !row.newItem) return null
  const existing = row.status === 'matched'
  const ambiguous = row.status === 'ambiguous'
  const lookupFailed = row.status === 'error' || row.existingOffer?.status === 'error'
  const primary = lookupFailed || ambiguous ? row.existingOffer : existing ? row.existingOffer : row.newItem
  const ready = !row.stale && !lookupFailed && !ambiguous && primary?.status === 'ready'
  const primaryLabel = ambiguous ? 'Select the correct Walmart catalog item' : existing ? 'Launch against existing Walmart item' : lookupFailed ? 'Walmart lookup needs review' : 'Create a new Walmart item'
  return <div className="mt-3 grid min-w-0 gap-2">
    <p className="text-xs text-muted-foreground">Last checked {row.checkedAt ? new Date(row.checkedAt).toLocaleString() : ''}. {row.stale ? 'Outdated — run the check again.' : 'Direct existing-item launch rechecks requirements before submission.'}</p>
    <div className={`min-w-0 rounded border p-3 ${ready ? 'border-emerald-500/40 bg-emerald-500/5' : ''}`}>
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">{primaryLabel}<Badge variant="outline" className={row.stale ? 'text-muted-foreground' : ready ? 'border-emerald-500 text-emerald-600' : 'border-amber-500 text-amber-600'}>{row.stale ? 'Recheck required' : ready ? 'Ready to launch' : 'Needs attention'}</Badge></p>
      {existing && <p className="mt-1 text-xs text-muted-foreground">Walmart already has this item and its category. A DataPlus Walmart category mapping is not required for this offer.</p>}
      {primary?.errors.map((error, index) => <p key={index} className="mt-1 break-words text-xs text-muted-foreground">{error.field}: {error.message}</p>)}
    </div>
    {existing && row.newItem && <details className="min-w-0 rounded border p-2 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium">New-item setup — separate fallback, not a blocker for this offer</summary><p className="mt-2">{row.newItem.status === 'ready' ? 'New-item requirements also passed the last check.' : 'Additional setup is needed only if creating a new Walmart catalog item.'}</p>{row.newItem.errors.map((error, index) => <p key={index} className="mt-1 break-words">{error.field}: {error.message}</p>)}</details>}
    {!existing && !lookupFailed && !ambiguous && <p className="text-xs text-muted-foreground">No existing offer match is available. Category mapping and full item requirements apply to this launch.</p>}
  </div>
}
export function WalmartReadiness({ sku }: { sku: string }) {
  const [row, setRow] = useState<Partial<MatchRow>>({}), [open, setOpen] = useState(false), [error, setError] = useState(''), [selectionVersion, setSelectionVersion] = useState(0)
  useEffect(() => {
    const refresh = (event: Event) => { if ((event as CustomEvent<{ sku?: string }>).detail?.sku === sku) setSelectionVersion(value => value + 1) }
    window.addEventListener('dataplus:walmart-catalog-selected', refresh)
    return () => window.removeEventListener('dataplus:walmart-catalog-selected', refresh)
  }, [sku])
  useEffect(() => {
    if (open) return
    const controller = new AbortController()
    setRow({}); setError('')
    request(`readiness?sku=${encodeURIComponent(sku)}`, undefined, controller.signal).then(setRow).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [sku, open, selectionVersion])
  return <div className="mt-3 min-w-0 rounded border p-3"><p className="text-sm font-medium">Walmart launch readiness</p>{error && <p className="text-sm text-destructive">{error}</p>}<WalmartReadinessResults row={row} />{!row.existingOffer && !error && <p className="text-xs text-muted-foreground">Not checked. Check both launch routes before preparing this SKU.</p>}<Button className="mt-2" variant="outline" onClick={() => setOpen(true)}>Check Walmart readiness</Button><WalmartUpcMatch readiness skus={[sku]} open={open} onOpenChange={setOpen} /></div>
}

function WalmartCatalogReference({ row }: { row: Partial<MatchRow> }) {
  const validId = /^[1-9][0-9]*$/.test(row.itemId || '')
  return <div className="mt-2 min-w-0 text-sm">{row.stale ? <p className="text-amber-600">Catalog match is outdated. Run Match on Walmart by UPC again.</p> : validId ? <><p>Walmart item ID: <span className="font-mono">{row.itemId}</span></p><a className="underline" href={`https://www.walmart.com/ip/${row.itemId}`} target="_blank" rel="noopener noreferrer">View Walmart catalog item</a></> : row.referenceMessage ? <p className="text-muted-foreground">{row.referenceMessage}</p> : null}</div>
}
export function WalmartCatalogMatch({ sku, refreshKey }: { sku: string; refreshKey: boolean }) {
  const [row, setRow] = useState<Partial<MatchRow>>({}), [error, setError] = useState(''), [message, setMessage] = useState(''), [savingKey, setSavingKey] = useState('')
  useEffect(() => {
    if (refreshKey) return
    const controller = new AbortController(); setError('')
    request(`catalog-match?sku=${encodeURIComponent(sku)}`, undefined, controller.signal).then(setRow).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [sku, refreshKey])
  async function select(candidate: WalmartCandidate) {
    setSavingKey(candidate.candidateKey); setError(''); setMessage('')
    try {
      const result = await request('catalog-match/select', { sku, candidateKey: candidate.candidateKey })
      setRow(current => ({ ...current, ...result.readiness, candidates: current.candidates || [], selectedCandidate: result.candidate }))
      setMessage(result.message)
      window.dispatchEvent(new CustomEvent('dataplus:walmart-catalog-selected', { detail: { sku } }))
    } catch (error) { setError(error instanceof Error ? error.message : 'Unable to save Walmart catalog selection') }
    finally { setSavingKey('') }
  }
  const candidates = row.candidates || []
  return <div className="mt-3 min-w-0 rounded border p-3"><p className="text-sm font-medium">Walmart catalog match</p><p className="text-xs text-muted-foreground">Catalog reference only. This does not mean your seller offer is linked or live.</p>{error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}{message && <p role="status" className="mt-2 text-sm text-emerald-700 dark:text-emerald-300">{message}</p>}<WalmartCatalogReference row={row} />{candidates.length > 1 && <div className="mt-3 grid gap-2"><p className="text-sm font-medium">Choose the correct Walmart item</p>{candidates.map(candidate => { const selected = row.selectedCandidate?.candidateKey === candidate.candidateKey; return <div key={candidate.candidateKey} className={`grid min-w-0 gap-3 rounded-md border p-3 sm:grid-cols-[48px_minmax(0,1fr)_auto] ${selected ? 'border-emerald-500/60 bg-emerald-500/5' : ''}`}>
    <div className="size-12 overflow-hidden rounded border bg-muted">{candidate.imageUrl ? <img src={candidate.imageUrl} alt="" className="size-full object-contain" /> : null}</div>
    <div className="min-w-0"><p className="break-words text-sm font-medium">{candidate.title || `Walmart item ${candidate.itemId || candidate.wpid || ''}`}</p><p className="mt-1 break-words text-xs text-muted-foreground">{[candidate.brand, candidate.productType].filter(Boolean).join(' · ') || 'No additional catalog details returned'}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{candidate.itemId ? `Item ID ${candidate.itemId}` : candidate.wpid ? `WPID ${candidate.wpid}` : candidate.candidateKey}</p>{candidate.productUrl && <a className="mt-1 inline-flex items-center gap-1 text-xs underline" href={candidate.productUrl} target="_blank" rel="noopener noreferrer">Open on Walmart <ExternalLink className="size-3" /></a>}</div>
    <Button size="sm" variant={selected ? 'outline' : 'default'} disabled={Boolean(savingKey) || selected} onClick={() => void select(candidate)}>{savingKey === candidate.candidateKey ? <Loader2 className="size-4 animate-spin" /> : selected ? <CircleCheck className="size-4 text-emerald-600" /> : null}{selected ? 'Selected' : 'Use this item'}</Button>
  </div>})}</div>}{row.checkedAt && <p className="mt-2 text-xs text-muted-foreground">Checked {new Date(row.checkedAt).toLocaleString()}</p>}{row.status === 'unchecked' && <p className="text-xs">Run Match on Walmart by UPC to save the catalog reference.</p>}{row.status === 'not_found' && <p className="text-xs">No catalog match returned at the last check.</p>}</div>
}
