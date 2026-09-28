import { useEffect, useState } from 'react'
import { Loader2, Link2, CircleCheck } from 'lucide-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog'
type Result = { status: string; reason?: string; sellerSku: string; catalogSku?: string; basis?: string; candidates?: string[]; publishedStatus?: string }
type Report = { status: string; jobNumber?: number; message?: string; total: number; processed?: number; linked?: number; review?: number; unmatched?: number; rows: Result[] }
async function api(path: string, method = 'GET', signal?: AbortSignal) {
  const response = await fetch(`/api/walmart/${path}`, { method, credentials: 'same-origin', signal, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}) })
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Walmart reconciliation failed'); return data
}
export function WalmartReconcile({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [jobId, setJobId] = useState(''), [report, setReport] = useState<Report | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open || !jobId) return
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try { const data = await api(`reconcile?jobId=${encodeURIComponent(jobId)}`, 'GET', controller.signal); if (controller.signal.aborted) return; setReport(data); setError(''); if (['queued','running','stopping'].includes(data.status)) timer = setTimeout(poll, 3000) }
      catch (err) { if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : 'Unable to load results'); timer = setTimeout(poll, 10000) } }
    }
    void poll(); return () => { controller.abort(); clearTimeout(timer) }
  }, [open, jobId])
  async function start() { setBusy(true); setError(''); try { const data = await api('reconcile', 'POST'); setJobId(data.job.id); setReport({ rows: [], total: 0, status: data.job.status, jobNumber: data.job.jobNumber, message: data.message }) } catch (err) { setError(err instanceof Error ? err.message : 'Unable to queue reconciliation') } finally { setBusy(false) } }
  const active = report && ['queued','running','stopping'].includes(report.status)
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value) }}><DialogContent className="flex max-h-[90dvh] w-[calc(100%_-_1rem)] flex-col overflow-hidden sm:max-w-3xl"><DialogHeader className="min-w-0 shrink-0 pr-6"><DialogTitle>Link existing Walmart listings</DialogTitle><DialogDescription>Download your seller listings and link them to the DataPlus catalog. Exact seller SKU comes first; a unique UPC/GTIN is the fallback. This updates local listing links only.</DialogDescription></DialogHeader>
    <div className="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto"><p className="text-sm text-muted-foreground">All seller listings are processed in background batches, including published and unpublished items. Conflicting links, ambiguous identifiers and uncertain selling packs are left for review. Existing listings, prices and inventory on Walmart are not changed.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {report && <div role="status" className="space-y-2 rounded-md border p-3 text-sm"><Badge variant="outline">{report.status}</Badge><p>{report.message}</p><p>{report.linked || 0} linked · {report.review || 0} need review · {report.unmatched || 0} unmatched</p><a className="underline" href="/jobs">Job {report.jobNumber || jobId} · download full results</a>{report.status === 'queued' && <p>Waiting for the external worker.</p>}</div>}
    {report?.rows.map((row, index) => <div key={`${row.sellerSku}-${index}`} className="min-w-0 rounded-md border p-3 text-sm"><div className="flex items-center gap-2">{row.status === 'linked' && <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-emerald-600" />}<strong className="break-all">{row.sellerSku}</strong><Badge variant="outline">{row.status}</Badge></div>{row.catalogSku && <p className="mt-1 break-words">DataPlus SKU: <a className="underline" href={`/products/${encodeURIComponent(row.catalogSku)}`}>{row.catalogSku}</a> · {row.basis === 'sku' ? 'Exact SKU' : 'UPC/GTIN'} · {row.publishedStatus}</p>}{row.reason && <p className="mt-1 break-words text-muted-foreground">{row.reason}</p>}{row.candidates?.length ? <p className="break-words">Candidates: {row.candidates.join(', ')}</p> : null}</div>)}
    {report && report.total > 100 && <p className="text-xs text-muted-foreground">Showing the latest 100 results. Full results remain in the job artifact.</p>}</div>
    <DialogFooter className="shrink-0 flex-nowrap gap-2 border-t pt-3"><Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Close</Button><Button disabled={busy || Boolean(active)} onClick={() => void start()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}{jobId ? 'Reconcile again' : 'Link existing listings'}</Button></DialogFooter>
  </DialogContent></Dialog>
}
