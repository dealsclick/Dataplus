import { useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Badge } from "./ui/badge"
import { Progress } from "./ui/progress"

export type ImportProgress = { percent: number | null; basis: string; label: string; scanned: number; created: number | null; updated: number | null; skipped: number | null; total: number | null; window: string | null; lastActivityAt: string | null; errorCount: number }
type Job = { id: string; jobNumber?: number; operation?: string; workerTask?: string; status?: string; phase?: string; importProgress: ImportProgress }
const count = (value: number | null) => value === null ? "Not reported" : value.toLocaleString()
export function ImportProgressSummary({ value }: { value: ImportProgress }) {
  return <section className="grid min-w-0 gap-2 text-sm">
    <div className="flex flex-wrap justify-between gap-2"><span>{value.label}</span><strong>{value.percent === null ? "Unknown" : `${value.percent}%`}</strong></div>
    {value.percent !== null && <Progress aria-label={value.label} value={value.percent} />}
    {value.basis === "date_coverage" && <p className="text-xs text-muted-foreground">Completed date windows only; not the percentage of orders or time remaining.</p>}
    {value.window && <p>Current window: {value.window}</p>}
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Scanned", value.scanned], ["Imported", value.created], ["Updated", value.updated], ["Skipped", value.skipped]].map(([label, n]) => <div key={String(label)}><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-medium tabular-nums">{count(n as number | null)}</dd></div>)}</dl>
  </section>
}
export function ImportDashboard({ compact = false }: { compact?: boolean }) {
  const [jobs, setJobs] = useState<Job[]>([]), [total, setTotal] = useState(0), [page, setPage] = useState(1)
  const [query, setQuery] = useState(""), [refresh, setRefresh] = useState(0), [error, setError] = useState("")
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    const load = async () => {
      if (document.hidden) { timer = setTimeout(load, 15000); return }
      try {
        const response = await fetch(`/api/import-jobs/progress?${new URLSearchParams({ page: String(page), q: query, active: compact ? "1" : "0" })}`, { signal: controller.signal })
        if (response.status === 403 && compact) { setJobs([]); setLoaded(true); return }
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || `Import status unavailable (${response.status})`)
        if (!stopped) { setJobs(result.jobs || []); setTotal(result.total || 0); setError(""); setLoaded(true) }
      } catch (e) { if (!stopped) setError(e instanceof Error ? e.message : "Import status unavailable") }
      finally { if (!stopped) timer = setTimeout(load, 15000) }
    }
    timer = setTimeout(load, 250)
    return () => { stopped = true; clearTimeout(timer); controller.abort() }
  }, [compact, page, query, refresh])
  if (compact) {
    if (error) return <a className="text-sm text-muted-foreground underline" href="/jobs?tab=imports">Import status unavailable. View Jobs</a>
    if (!jobs.length) return null
    return <aside className="flex flex-wrap items-center gap-3 border-y py-2 text-sm"><span className="font-medium">Imports in progress ({total})</span>{jobs.slice(0, 3).map(job => <a className="text-primary underline" key={job.id} href={`/jobs/${encodeURIComponent(job.id)}`}>{job.operation || job.workerTask} / {job.status} / {job.importProgress.percent === null ? "Total unknown" : `${job.importProgress.percent}% ${job.importProgress.basis === "date_coverage" ? "date coverage" : "progress"}`}</a>)}<a className="ml-auto text-primary underline" href="/jobs?tab=imports">View all imports</a></aside>
  }
  return <section className="grid min-w-0 gap-4" aria-label="Import dashboard">
    <div className="flex items-center gap-2"><Input aria-label="Search imports" className="max-w-md" placeholder="Search channel or import" value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} /><Button size="icon" variant="outline" title="Refresh imports" onClick={() => setRefresh(value => value + 1)}><RefreshCw className="size-4" /></Button></div>
    {error && <p role="alert" className="text-destructive">{error} Previously loaded progress may be stale.</p>}
    {!loaded && !error && <p role="status">Loading imports...</p>}
    {jobs.map(job => { const progress = job.importProgress; const stale = job.status === "running" && progress.lastActivityAt && Date.now() - Date.parse(progress.lastActivityAt) > 120000; return <article key={job.id} className="grid min-w-0 gap-3 border-b py-4">
      <header className="flex flex-wrap items-center gap-2"><a className="break-words font-medium text-primary underline" href={`/jobs/${encodeURIComponent(job.id)}`}>{job.operation || job.workerTask || "Import"} / {job.jobNumber ? `JOB-${job.jobNumber}` : job.id.slice(0, 8)}</a><Badge variant="outline">{job.status}</Badge>{stale && <Badge variant="warning">No recent progress</Badge>}<span className="ml-auto text-xs text-muted-foreground">{(job.phase || "queued").replaceAll("_", " ")}</span></header>
      <ImportProgressSummary value={progress} />
      <footer className="flex flex-wrap gap-3 text-xs text-muted-foreground"><span>Last activity: {progress.lastActivityAt ? new Date(progress.lastActivityAt).toLocaleString() : "Not reported"}</span><span>Reported errors: {progress.errorCount}</span><a className="text-primary underline" href={`/jobs/${encodeURIComponent(job.id)}`}>Details, skip results and downloads</a></footer>
    </article> })}
    {loaded && !jobs.length && !error && <p>No imports match this view.</p>}
    <footer className="flex flex-wrap items-center justify-between gap-3 text-sm"><span>{total.toLocaleString()} imports / Page {page} of {Math.max(1, Math.ceil(total / 25))}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={page * 25 >= total} onClick={() => setPage(value => value + 1)}>Next</Button></div></footer>
  </section>
}
