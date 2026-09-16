import { useEffect, useState } from 'react'
import { Check, CircleCheck, ChevronDown, ChevronRight, FolderTree, Loader2, Search, X } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog'

export type TaxonomyChoice = { key: string; id: string; name: string; path: string; parent: string; selectable: boolean; hasChildren: boolean; taxonomyVersion?: string; categoryHandle?: string; googleCategory?: { id?: string; fullName?: string; breadcrumb?: string } | null }
type Page = { rows: TaxonomyChoice[]; hasMore: boolean; total: number; version?: string; updatedAt?: string; source?: string }
type BranchProps = { endpoint: string; parent?: string; query?: string; selected?: string; saved?: string; readOnly?: boolean; onSelect: (row: TaxonomyChoice) => void; depth?: number }

function Branch({ endpoint, parent = '', query = '', selected, saved, readOnly, onSelect, depth = 0 }: BranchProps) {
  const [page, setPage] = useState<Page | null>(null)
  const [rows, setRows] = useState<TaxonomyChoice[]>([])
  const [offset, setOffset] = useState(0)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    const timeout = window.setTimeout(() => controller.abort(), 15000)
    setBusy(true); setError('')
    fetch(`${endpoint}?${new URLSearchParams({ parent, q: query, offset: String(offset) })}`, { credentials: 'same-origin', signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to load categories'); return data as Page })
      .then(data => { if (active) { setPage(data); setRows(previous => offset ? [...previous, ...data.rows] : data.rows) } })
      .catch(error => { if (active) setError(error.name === 'AbortError' ? 'Category lookup timed out. Try again.' : error.message) })
      .finally(() => { clearTimeout(timeout); if (active) setBusy(false) })
    return () => { active = false; clearTimeout(timeout); controller.abort() }
  }, [endpoint, parent, query, offset, retry])
  return <div className="min-w-0" aria-busy={busy}>
    {depth === 0 && page && <p className="mb-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{page.source} {page.version ? `| Version ${page.version}` : ''}{page.updatedAt ? ` | Refreshed ${new Date(page.updatedAt).toLocaleString()}` : ''}</p>}
    <ul aria-label={parent ? 'Subcategories' : query ? 'Matching categories' : 'Category tree'} className="min-w-0 space-y-1">
      {rows.map(row => <li key={row.key} className="min-w-0">
        <div className={`flex min-w-0 items-start gap-1 rounded-md border p-1 ${row.id && row.id === selected ? 'border-amber-500/60 bg-amber-500/10' : row.id && row.id === saved ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-transparent hover:bg-muted/60'}`}>
          {row.hasChildren ? <Button size="icon" variant="ghost" className="size-8 shrink-0" title={`${expanded.has(row.key) ? 'Collapse' : 'Expand'} ${row.name}`} aria-label={`${expanded.has(row.key) ? 'Collapse' : 'Expand'} ${row.name}`} aria-expanded={expanded.has(row.key)} onClick={() => setExpanded(previous => { const next = new Set(previous); if (next.has(row.key)) next.delete(row.key); else next.add(row.key); return next })}>{expanded.has(row.key) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</Button> : <span className="w-8 shrink-0" />}
          <button type="button" disabled={readOnly || !row.selectable} aria-pressed={Boolean(row.id && row.id === selected)} className="min-w-0 flex-1 p-1.5 text-left text-sm leading-5 [overflow-wrap:anywhere] disabled:cursor-default focus-visible:outline-2 focus-visible:outline-ring" onClick={() => onSelect(row)}>
            <span className="font-medium">{row.name}</span>
            {query && <span className="mt-1 block text-xs text-muted-foreground">{row.path}</span>}
            {row.id && <span className="block text-xs text-muted-foreground">{row.id}</span>}
          </button>
          {row.id && row.id === saved && <CircleCheck aria-label="Saved mapping" className="m-2 size-4 shrink-0 text-emerald-700 dark:text-emerald-400" />}
          {row.id && row.id === selected && <Check aria-label="Draft selection" className="m-2 size-4 shrink-0 text-amber-700 dark:text-amber-300" />}
        </div>
        {expanded.has(row.key) && <div className="ml-3 min-w-0 border-l pl-2"><Branch endpoint={endpoint} parent={row.key} selected={selected} saved={saved} readOnly={readOnly} onSelect={onSelect} depth={depth + 1} /></div>}
      </li>)}
    </ul>
    {busy && <p role="status" className="flex items-center gap-2 p-2 text-xs"><Loader2 className="size-4 animate-spin" /> Loading categories...</p>}
    {error && <div role="alert" className="p-2 text-sm text-destructive">{error}<Button variant="outline" size="sm" className="ml-2" onClick={() => setRetry(value => value + 1)}>Retry</Button></div>}
    {!busy && !error && !rows.length && <p role="status" className="p-2 text-sm text-muted-foreground">{query ? 'No matching cached categories.' : 'No cached categories in this branch.'}</p>}
    {!busy && !error && page?.hasMore && <Button size="sm" variant="outline" className="my-2" onClick={() => setOffset(rows.length)}>Load more ({rows.length} of {page.total})</Button>}
  </div>
}

export function ChannelCategoryPicker({ channel, localCategory, savedId, selectedId, disabled, readOnly, onSelect, compact = false }: { channel: string; localCategory: string; savedId?: string; selectedId?: string; disabled?: boolean; readOnly?: boolean; compact?: boolean; onSelect: (row: TaxonomyChoice) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [choice, setChoice] = useState<TaxonomyChoice | null>(null)
  const key = channel.toLowerCase()
  const endpoint = key === 'walmart' ? '/api/walmart/taxonomy/tree' : `/api/categories/taxonomy/${key}/tree`
  useEffect(() => { if (!open) return; const timer = setTimeout(() => setSearch(query.trim()), 300); return () => clearTimeout(timer) }, [query, open])
  return <Dialog open={open} onOpenChange={value => { setOpen(value); if (value) { setQuery(''); setSearch(''); setChoice(null) } }}>
    <DialogTrigger asChild><Button type="button" variant="outline" size={compact ? 'icon' : 'default'} className={compact ? 'size-8 shrink-0' : ''} disabled={disabled} aria-label={`Search / browse ${channel}`} title={`Search / browse ${channel}`}><FolderTree className="size-4" />{!compact && <>Search / browse {channel}</>}</Button></DialogTrigger>
    <DialogContent className="flex h-[min(90dvh,800px)] max-w-[calc(100vw-1rem)] flex-col gap-3 overflow-hidden p-4 sm:max-w-3xl">
      <DialogHeader className="shrink-0 pr-7"><DialogTitle>{channel} categories</DialogTitle><DialogDescription className="[overflow-wrap:anywhere]">{localCategory}</DialogDescription></DialogHeader>
      <div className="relative shrink-0"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input autoFocus aria-label={`Search ${channel} category tree`} placeholder="Search categories or IDs" className="pl-9 pr-9" value={query} onChange={event => setQuery(event.target.value)} />{query && <Button size="icon" variant="ghost" className="absolute right-1 top-1 size-7" aria-label="Clear category search" title="Clear search" onClick={() => { setQuery(''); setSearch('') }}><X className="size-4" /></Button>}</div>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"><Branch key={`${endpoint}:${search}`} endpoint={endpoint} query={search} selected={choice?.id || selectedId} saved={savedId} readOnly={readOnly} onSelect={setChoice} /></div>
      <div role="status" className="shrink-0 border-t pt-3 text-xs [overflow-wrap:anywhere]">{readOnly ? 'Protected mapping. Unlock in Protection & review to select a replacement.' : choice ? <><span className="font-semibold text-amber-800 dark:text-amber-200">Unsaved selection: </span>{choice.path}</> : 'No new selection'}</div>
      <DialogFooter className="shrink-0 pb-[env(safe-area-inset-bottom)]"><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!choice || disabled || readOnly} onClick={() => { if (choice && !readOnly) { onSelect(choice); setOpen(false) } }}><Check className="size-4" /> Use category</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
