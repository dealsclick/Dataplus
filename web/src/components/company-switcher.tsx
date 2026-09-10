import { useEffect, useState } from 'react'
import { Check, ChevronsUpDown, Building2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/dropdown-menu'

export type CompanyChoice = { tenant_id: string; id: string; name: string; currency: string; mode: string }
export type CompanyDirectory = { initialized: boolean; tenants: { id: string; name: string; role: string }[]; companies: CompanyChoice[]; selection: { tenantId: string; companyId: string } | null }
export async function companyRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || 'Unable to load company access.')
  return data
}
export function currentCompany(directory: CompanyDirectory) {
  const selection = directory.selection || { tenantId: 'organization-default', companyId: 'linq-usa' }
  return directory.companies.find(c => c.tenant_id === selection.tenantId && c.id === selection.companyId)
}
export async function activateCompany(company: { tenant_id: string; id: string }) {
  const result = await companyRequest<{ operationsAvailable: boolean }>('/api/organization/select', 'POST', { tenantId: company.tenant_id, companyId: company.id })
  try { localStorage.setItem('dataplus-company-changed', `${Date.now()}:${company.tenant_id}:${company.id}`) } catch { /* Storage may be disabled. */ }
  return result
}
export function CompanySwitcher() {
  const [directory, setDirectory] = useState<CompanyDirectory | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    const load = () => { void companyRequest<CompanyDirectory>('/api/organization').then(data => { if (alive) { setDirectory(data); setError('') } }).catch(e => { if (alive) setError(e.message) }) }
    const changed = (event: StorageEvent) => { if (event.key === 'dataplus-company-changed') window.location.reload() }
    load(); window.addEventListener('company-directory-changed', load); window.addEventListener('storage', changed)
    return () => { alive = false; window.removeEventListener('company-directory-changed', load); window.removeEventListener('storage', changed) }
  }, [])
  const active = directory ? currentCompany(directory) : undefined
  async function select(company: CompanyChoice) {
    setBusy(true); setError('')
    try {
      await activateCompany(company)
      const tools = window.location.pathname.startsWith('/orders/tools') || window.location.pathname === '/orders/imports'
      window.location.assign(tools ? '/orders/tools' : '/orders')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to switch company.'); setBusy(false) }
  }
  const label = active?.name || (directory?.initialized === false ? 'LINQ USA dba Dealsclick' : directory ? 'Select company' : error ? 'Company unavailable' : 'Loading company…')
  return <DropdownMenu onOpenChange={open => { if (!open) setQuery('') }}><DropdownMenuTrigger asChild>
    <Button variant="outline" disabled={busy} className="max-w-full sm:max-w-72" aria-label={`Current company: ${label}. Switch company`} title={label}><Building2 className="size-4 shrink-0"/><span className="truncate">{label}</span><ChevronsUpDown className="size-4 shrink-0"/></Button>
  </DropdownMenuTrigger><DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
    <DropdownMenuLabel>Switch company</DropdownMenuLabel>
    {error && <p role="alert" className="px-2 py-1 text-sm text-destructive">{error}</p>}
    {directory?.initialized === false ? <><p className="px-2 py-2 text-sm text-muted-foreground">LINQ is your current operational company. Complete one-time setup to enable company switching.</p><DropdownMenuItem asChild><a href="/settings?tab=companies">Open Companies settings</a></DropdownMenuItem></> : <>
      <div className="p-2"><Input aria-label="Search companies" placeholder="Search companies…" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.stopPropagation()}/></div>
      <div className="max-h-72 overflow-y-auto">{directory?.companies.filter(c => c.name.toLowerCase().includes(query.toLowerCase())).map(c => <DropdownMenuItem key={`${c.tenant_id}/${c.id}`} disabled={busy} onSelect={() => void select(c)} className="items-start">
        <Check className={`mt-1 size-4 shrink-0 ${active?.id === c.id && active.tenant_id === c.tenant_id ? '' : 'invisible'}`}/><span className="min-w-0"><span className="block break-words">{c.name}</span><span className="block text-xs text-muted-foreground">{directory.tenants.find(t => t.id === c.tenant_id)?.name}</span></span>
      </DropdownMenuItem>)}</div>
      {directory && !directory.companies.filter(c => c.name.toLowerCase().includes(query.toLowerCase())).length && <p className="p-2 text-sm text-muted-foreground">No accessible companies found.</p>}
    </>}
  </DropdownMenuContent></DropdownMenu>
}
