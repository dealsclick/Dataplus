import type { ReactNode } from 'react'
import { useState } from 'react'
import { Check, CircleCheck, Clock3, Loader2, LockKeyhole, Search, Save } from 'lucide-react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { ChannelCategoryPicker, type TaxonomyChoice } from './channel-category-picker'

export type MappingSearchResult = { id: string; path: string; detail?: string }

export function CategoryPath({ value }: { value: string }) {
  const parts = value.split(/\s*>\s*|\s*\u203a\s*/).filter(Boolean)
  const leaf = parts.pop()
  return <div className="min-w-0 [overflow-wrap:anywhere]">
    <p className="text-sm font-semibold leading-6">{leaf || 'Not mapped'}</p>
    {parts.length > 0 && <p className="mt-1 text-xs leading-5 text-muted-foreground">{parts.join(' > ')}</p>}
  </div>
}

type Props = {
  channel: string; localCategory: string; categoryPath: string; categoryId?: string
  dirty?: boolean; locked?: boolean; busy?: boolean; searching?: boolean
  query: string; onQuery: (query: string) => void; onSearch: () => void
  results: MappingSearchResult[]; onSelect: (id: string) => void
  onSave: () => void; onDiscard?: () => void; onSaveAndUpdate?: () => void
  lastRefresh?: string; status?: string; notice?: ReactNode; pagination?: ReactNode
  children?: ReactNode; review?: ReactNode
  savedId?: string; onTreeSelect?: (row: TaxonomyChoice) => void
}

export function CategoryMappingWorkspace(props: Props) {
  const { channel, dirty, locked, busy, searching } = props
  const [searched, setSearched] = useState(false)
  const saved = Boolean(props.categoryId) && !dirty
  return <div className="min-w-0 text-sm" aria-busy={busy || searching}>
    <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
      <h3 className="text-sm font-semibold">{channel} mapping</h3>
      <div className="flex flex-wrap items-center gap-2">
        {locked && <Badge variant="outline" className="gap-1"><LockKeyhole className="size-3" /> Protected</Badge>}
        <Badge variant="outline" className={dirty ? 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200' : props.categoryId ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200' : 'text-muted-foreground'}>{dirty ? 'Unsaved changes' : props.categoryId ? 'Saved mapping' : 'Not mapped'}</Badge>
      </div>
    </header>
    <div className="grid min-w-0 divide-y border-b md:grid-cols-2 md:divide-x md:divide-y-0">
      <section className="min-w-0 bg-muted/25 p-4"><p className="mb-2 text-xs font-medium text-muted-foreground">Local category</p><CategoryPath value={props.localCategory} /></section>
      <section aria-label={saved ? 'Saved channel mapping' : 'Channel mapping selection'} className={`min-w-0 border-l-2 p-4 ${saved ? 'border-l-emerald-600 bg-emerald-500/10 dark:border-l-emerald-400 dark:bg-emerald-500/15' : dirty ? 'border-l-amber-500 bg-amber-500/10' : 'border-l-transparent bg-muted/25'}`}>
        <p className={`mb-2 flex items-center gap-2 text-xs font-medium ${saved ? 'text-emerald-800 dark:text-emerald-200' : 'text-muted-foreground'}`}>{saved && <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400" />}{saved ? 'Saved channel mapping' : dirty ? 'Unsaved selection' : 'Channel category'}</p>
        <CategoryPath value={props.categoryPath} />{props.categoryId && <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{props.categoryId}</p>}
      </section>
    </div>
    {props.review && <div className="min-w-0 border-b py-4">{props.review}</div>}
    <section className="min-w-0 space-y-3 py-4">
      {props.onTreeSelect ? <ChannelCategoryPicker key={`${channel}:${props.localCategory}`} channel={channel} localCategory={props.localCategory} selectedId={props.categoryId} savedId={props.savedId} disabled={busy} readOnly={locked} onSelect={props.onTreeSelect} /> : <>
      <form className="flex min-w-0 gap-2" onSubmit={event => { event.preventDefault(); if (!busy && !searching) { setSearched(true); props.onSearch() } }}>
        <div className="relative min-w-0 flex-1"><Search aria-hidden className="absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input aria-label={`Search ${channel} categories`} className="pl-9" value={props.query} onChange={event => props.onQuery(event.target.value)} placeholder="Search categories" /></div>
        <Button type="submit" variant="outline" disabled={busy || searching}>{searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />} Search</Button>
      </form>
      {props.notice}
      {searched && !busy && !searching && props.results.length === 0 && <p role="status" className="text-xs text-muted-foreground">No matching categories.</p>}
      {props.results.length > 0 && <div className="max-h-72 overflow-y-auto rounded-md border" aria-label={`${channel} category results`}>
        {props.results.map(result => <button key={result.id} type="button" aria-pressed={result.id === props.categoryId} disabled={busy || locked} onClick={() => { setSearched(false); props.onSelect(result.id) }} className="flex w-full min-w-0 items-start gap-3 border-b p-3 text-left last:border-b-0 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60">
          <span className="mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border">{result.id === props.categoryId && <Check className="size-3" />}</span>
          <div className="min-w-0 flex-1"><CategoryPath value={result.path} /><p className="mt-1 break-all text-xs text-muted-foreground">{result.detail || result.id}</p></div>
        </button>)}
      </div>}
      {props.pagination}
      </>}
      {props.onTreeSelect && props.notice}
    </section>
    <div className="min-w-0 space-y-4 border-t py-4">{props.children}</div>
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t bg-background py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div role="status" className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-3.5 shrink-0" /><span className="[overflow-wrap:anywhere]">{props.status || (props.lastRefresh ? `Last refresh: ${props.lastRefresh}` : 'No refresh recorded')}</span></div>
      <div className="flex flex-wrap gap-2">
        {dirty && props.onDiscard && <Button size="sm" variant="ghost" disabled={busy} onClick={props.onDiscard}>Discard</Button>}
        <Button size="sm" disabled={busy || !props.categoryId || !dirty} onClick={props.onSave}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save</Button>
        {props.onSaveAndUpdate && <Button size="sm" variant="outline" disabled={busy || !props.categoryId} onClick={props.onSaveAndUpdate}>Save & update</Button>}
      </div>
    </footer>
  </div>
}
