import { useEffect, useState } from 'react'
import { WalmartLaunch } from './walmart-launch'
import { Search, Loader2, CircleCheck } from 'lucide-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog'

type ReadinessState = { status: string; errors: Array<{ field: string; message: string }> }
type MatchRow = { existingOffer?: ReadinessState; newItem?: ReadinessState; checkedAt?: string; stale?: boolean; sku: string; title?: string; identifier?: { kind: string; value: string }; status: string; productType?: string; error?: string; packReviewRequired?: boolean }
type Batch = { rows: MatchRow[]; total: number; processed?: number; matchedCount?: number; complete: boolean; status: string; message?: string; jobNumber?: number }
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
    <DialogHeader className="min-w-0 shrink-0 pr-6"><DialogTitle>{readiness ? 'Check Walmart readiness' : 'Match on Walmart by UPC'}</DialogTitle><DialogDescription>Search Walmart US for {selectionRequest?.count ?? skus.length} selected catalog item{(selectionRequest?.count ?? skus.length) === 1 ? '' : 's'} using saved UPC, EAN or GTIN. Matching does not create a listing or link a seller SKU. {readiness && "Both existing-offer and new-item requirements are checked. Results expire after 24 hours; launch always requires a fresh review."}</DialogDescription></DialogHeader>
    <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto">
      {error && <p role="alert" className="rounded border border-destructive p-3 text-sm text-destructive">{error}</p>}
      {!batch && <p className="break-words rounded-md border bg-muted/30 p-3 text-sm">{selectionRequest ? `All ${selectionRequest.count.toLocaleString()} filtered products. Filters are evaluated when the job stages its selection.` : skus.length === 1 ? 'One product: lookup runs immediately, without waiting for a background job.' : `${skus.length.toLocaleString()} selected records. Products are processed in background batches.`}</p>}
      {batch && <div role="status" className="flex flex-wrap items-center gap-2 text-sm"><Badge variant="outline">{batch.status}</Badge><span>{batch.processed ?? batch.rows.length} / {batch.total} checked · {batch.matchedCount ?? matched.length} matched</span>{jobId && <a className="underline" href="/jobs">Job {batch.jobNumber || jobId}</a>}{batch.message && <p className="w-full text-muted-foreground">{batch.message}</p>}{batch.status === 'queued' && <p className="w-full text-muted-foreground">Waiting for the external worker. Results appear here as items are checked.</p>}</div>}
      {batch?.rows.map(row => <div key={row.sku} className="grid min-w-0 gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0"><p className="flex items-start gap-2 break-words font-semibold">{row.status === 'matched' && <CircleCheck className="size-5 shrink-0 text-emerald-600" aria-hidden="true" />}{row.sku}</p><p className="break-words text-sm text-muted-foreground">{row.title}</p><p className="text-xs">{row.identifier && `${row.identifier.kind.toUpperCase()}: ${row.identifier.value}`}</p><p className="mt-1 break-words text-sm">{row.error || (row.status === 'matched' ? 'Existing Walmart catalog item found — offer setup available.' : row.status === 'full_setup' ? 'Walmart returned item data; full item setup is required.' : 'No match returned — review category mapping for full item setup.')}</p><WalmartReadinessResults row={row} />{row.packReviewRequired && <p className="text-sm text-amber-700 dark:text-amber-400">Confirm that the identifier represents this selling pack during launch review.</p>}</div>
        {row.status !== 'error' && <Button size="sm" variant="outline" onClick={() => setLaunchSku(row.sku)}>Review launch</Button>}
      </div>)}
      {batch && batch.total > 100 && <div className="flex flex-wrap items-center gap-2 text-sm"><Button size="sm" variant="outline" disabled={!offset} onClick={() => setOffset(value => Math.max(0, value - 100))}>Previous results</Button><span>Results {offset + 1}–{offset + batch.rows.length}</span><Button size="sm" variant="outline" disabled={offset + 100 >= (batch.processed || 0)} onClick={() => setOffset(value => value + 100)}>Next results</Button><span className="text-muted-foreground">Full results are downloadable from Jobs.</span></div>}
    </div>
    <DialogFooter className="shrink-0 gap-2 border-t pt-3"><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>{matched.length > 1 && batch?.complete && <Button variant="outline" asChild><a href={`/products?action=walmart-launch&skus=${encodeURIComponent(matched.join('\n'))}`}>Review {matched.length} shown matched item{matched.length === 1 ? '' : 's'}</a></Button>}<Button disabled={busy || Boolean(active) || (skus.length < 1 && !selectionRequest)} onClick={() => void start()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}{busy ? 'Checking Walmart…' : readiness ? 'Check readiness' : batch ? 'Match again' : 'Match on Walmart by UPC'}</Button></DialogFooter>
  </DialogContent></Dialog><WalmartLaunch sku={launchSku} open={Boolean(launchSku) && open} onOpenChange={value => { if (!value) setLaunchSku('') }} /></>
}

export function WalmartReadinessResults({ row }: { row: Partial<MatchRow> }) {
  if (!row.existingOffer && !row.newItem) return null
  return <div className="mt-3 grid min-w-0 gap-2"><p className="text-xs text-muted-foreground">Last checked {row.checkedAt ? new Date(row.checkedAt).toLocaleString() : ''}. {row.stale ? 'Outdated — run the check again.' : 'Saved assessment only. Final launch review is required.'}</p>{([['Existing offer', row.existingOffer], ['New item', row.newItem]] as const).map(([label, result]) => result && <div key={label} className="min-w-0 rounded border p-2"><p className="flex flex-wrap items-center gap-2 text-sm font-medium">{label}<Badge variant="outline" className={row.stale ? 'text-muted-foreground' : result.status === 'ready' ? 'border-emerald-500 text-emerald-600' : 'border-amber-500 text-amber-600'}>{row.stale ? 'Recheck required' : result.status === 'ready' ? 'Ready for review' : result.status === 'not_found' ? 'No offer match' : result.status === 'error' ? 'Check failed' : 'Needs attention'}</Badge></p>{result.errors.map((error, index) => <p key={index} className="break-words text-xs text-muted-foreground">{error.field}: {error.message}</p>)}</div>)}</div>
}
export function WalmartReadiness({ sku }: { sku: string }) {
  const [row, setRow] = useState<Partial<MatchRow>>({}), [open, setOpen] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    if (open) return
    const controller = new AbortController()
    setRow({}); setError('')
    request(`readiness?sku=${encodeURIComponent(sku)}`, undefined, controller.signal).then(setRow).catch(error => { if (!controller.signal.aborted) setError(error.message) })
    return () => controller.abort()
  }, [sku, open])
  return <div className="mt-3 min-w-0 rounded border p-3"><p className="text-sm font-medium">Walmart launch readiness</p>{error && <p className="text-sm text-destructive">{error}</p>}<WalmartReadinessResults row={row} />{!row.existingOffer && !error && <p className="text-xs text-muted-foreground">Not checked. Check both launch routes before preparing this SKU.</p>}<Button className="mt-2" variant="outline" onClick={() => setOpen(true)}>Check Walmart readiness</Button><WalmartUpcMatch readiness skus={[sku]} open={open} onOpenChange={setOpen} /></div>
}
