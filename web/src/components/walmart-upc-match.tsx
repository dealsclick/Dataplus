import { useEffect, useState } from 'react'
import { Search, Loader2, CircleCheck } from 'lucide-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog'

type MatchRow = { sku: string; title?: string; identifier?: { kind: string; value: string }; status: string; productType?: string; error?: string; packReviewRequired?: boolean }
type Batch = { rows: MatchRow[]; total: number; processed?: number; matchedCount?: number; complete: boolean; status: string; message?: string; jobNumber?: number }
async function request(path: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(`/api/walmart/${path}`, { credentials: 'same-origin', signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Walmart lookup failed')
  return result
}
export function WalmartUpcMatch({ skus, selectionRequest, open, onOpenChange }: { skus: string[]; selectionRequest?: { allFiltered: true; query: string; filters: Record<string, string>; count: number }; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [jobId, setJobId] = useState('')
  const [batch, setBatch] = useState<Batch | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [offset, setOffset] = useState(0)
  const selection = JSON.stringify([skus, selectionRequest])
  useEffect(() => { setJobId(''); setBatch(null); setError(''); setOffset(0) }, [selection])
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
    try { const result = await request('match', { skus, ...selectionRequest }); setOffset(0); setJobId(result.job.id); setBatch({ rows: [], total: skus.length, complete: false, status: result.job.status, jobNumber: result.job.jobNumber, message: result.message }) }
    catch (err) { setError(err instanceof Error ? err.message : 'Unable to queue match') }
    finally { setBusy(false) }
  }
  const matched = batch?.rows.filter(row => row.status === 'matched').map(row => row.sku) || []
  const active = batch && ['queued', 'running', 'stopping'].includes(batch.status) && !batch.complete
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value) }}><DialogContent className="flex max-h-[90dvh] w-[calc(100%_-_1rem)] flex-col overflow-hidden sm:max-w-3xl">
    <DialogHeader><DialogTitle>Match on Walmart by UPC</DialogTitle><DialogDescription>Search Walmart US for {selectionRequest?.count ?? skus.length} selected catalog item{(selectionRequest?.count ?? skus.length) === 1 ? '' : 's'} using saved UPC, EAN or GTIN. Matching does not create a listing or link a seller SKU.</DialogDescription></DialogHeader>
    <div className="min-h-0 space-y-3 overflow-y-auto">
      {error && <p role="alert" className="rounded border border-destructive p-3 text-sm text-destructive">{error}</p>}
      {!jobId && <p className="break-words rounded-md border bg-muted/30 p-3 text-sm">{selectionRequest ? `All ${selectionRequest.count.toLocaleString()} filtered products. Filters are evaluated when the job stages its selection.` : `${skus.length.toLocaleString()} selected records. Products are processed in background batches.`}</p>}
      {batch && <div role="status" className="flex flex-wrap items-center gap-2 text-sm"><Badge variant="outline">{batch.status}</Badge><span>{batch.processed ?? batch.rows.length} / {batch.total} checked · {batch.matchedCount ?? matched.length} matched</span><a className="underline" href="/jobs">Job {batch.jobNumber || jobId}</a>{batch.message && <p className="w-full text-muted-foreground">{batch.message}</p>}{batch.status === 'queued' && <p className="w-full text-muted-foreground">Waiting for the external worker. Results appear here as items are checked.</p>}</div>}
      {batch?.rows.map(row => <div key={row.sku} className="grid min-w-0 gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0"><p className="flex items-start gap-2 break-words font-semibold">{row.status === 'matched' && <CircleCheck className="size-5 shrink-0 text-emerald-600" aria-hidden="true" />}{row.sku}</p><p className="break-words text-sm text-muted-foreground">{row.title}</p><p className="text-xs">{row.identifier && `${row.identifier.kind.toUpperCase()}: ${row.identifier.value}`}</p><p className="mt-1 break-words text-sm">{row.error || (row.status === 'matched' ? 'Existing Walmart catalog item found — offer setup available.' : row.status === 'full_setup' ? 'Walmart returned item data; full item setup is required.' : 'No match returned — review category mapping for full item setup.')}</p>{row.packReviewRequired && <p className="text-sm text-amber-700 dark:text-amber-400">Confirm that the identifier represents this selling pack during launch review.</p>}</div>
        {row.status !== 'error' && <Button size="sm" variant="outline" asChild><a href={`/products?action=walmart-launch&sku=${encodeURIComponent(row.sku)}`}>Review launch</a></Button>}
      </div>)}
      {batch && batch.total > 100 && <div className="flex flex-wrap items-center gap-2 text-sm"><Button size="sm" variant="outline" disabled={!offset} onClick={() => setOffset(value => Math.max(0, value - 100))}>Previous results</Button><span>Results {offset + 1}–{offset + batch.rows.length}</span><Button size="sm" variant="outline" disabled={offset + 100 >= (batch.processed || 0)} onClick={() => setOffset(value => value + 100)}>Next results</Button><span className="text-muted-foreground">Full results are downloadable from Jobs.</span></div>}
    </div>
    <DialogFooter className="flex-wrap gap-2 border-t pt-3"><Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Close</Button>{matched.length > 0 && batch?.complete && <Button variant="outline" asChild><a href={`/products?action=walmart-launch&skus=${encodeURIComponent(matched.join('\n'))}`}>Review {matched.length} shown matched item{matched.length === 1 ? '' : 's'}</a></Button>}<Button disabled={busy || Boolean(active) || (skus.length < 1 && !selectionRequest)} onClick={() => void start()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}{jobId ? 'Match again' : 'Match on Walmart by UPC'}</Button></DialogFooter>
  </DialogContent></Dialog>
}
