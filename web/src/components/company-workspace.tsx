import { activateCompany } from './company-switcher'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'

type Company = { tenant_id: string; id: string; name: string; mode: string; currency: string }
type Directory = { initialized: boolean; canInitialize: boolean; tenants: { id: string; name: string; role: string }[]; companies: Company[]; selection: { tenantId: string; companyId: string } | null }
type Product = { product_id: string; source_sku: string; title: string; brand: string; barcode: string; uom: string; company_sku: string; selected: boolean }
type Account = { id: string; supplier_name: string; account_reference: string }
type Cost = { vendor_account_id: string; supplier_name: string; unit_cost: string | null; uom: string }
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const data = await response.json()
  if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to DataPlus to manage your companies.' : data.error || 'Request failed.')
  return data
}

export function CompanyWorkspace() {
  const [directory, setDirectory] = useState<Directory | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState<Company | null>(null)
  const [newCompany, setNewCompany] = useState(false)
  const [name, setName] = useState('')
  const [created, setCreated] = useState<Company | null>(null)
  const [tenantId, setTenantId] = useState('')
  async function load() {
    const data = await request<Directory>('/api/organization')
    setDirectory(data)
    window.dispatchEvent(new Event("company-directory-changed"))
    setTenantId(current => current || data.tenants[0]?.id || '')
    setActive(data.companies.find(c => c.tenant_id === data.selection?.tenantId && c.id === data.selection?.companyId) || null)
  }
  useEffect(() => { void load().catch(e => setError(e.message)) }, [])
  async function run(work: () => Promise<void>) {
    setBusy(true); setError('')
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save.') } finally { setBusy(false) }
  }
  async function select(company: Company) {
    setActive(company)
  }
  const owner = directory?.tenants.find(t => t.id === tenantId)?.role === 'owner'
  return <section className="min-w-0 space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><h2 className="text-xl font-semibold">Companies</h2><p className="text-sm text-muted-foreground">Manage companies, shared product information, and separate vendor accounts and costs. Assign company access in Settings → Users.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" asChild><a href="/orders/tools">Order Tools</a></Button>
        {directory?.initialized && <DropdownMenu><DropdownMenuTrigger asChild><Button disabled={busy}>Actions</Button></DropdownMenuTrigger><DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => void run(load)}>Refresh</DropdownMenuItem>
        </DropdownMenuContent></DropdownMenu>}
      </div>
    </header>
    {error && <div role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</div>}
    {!directory && !error && <p role="status">Loading companies…</p>}
    {directory && !directory.initialized && <Card><CardHeader><CardTitle>One-time company setup</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Run this once to enable company management. After setup, this notice is replaced by your company list and the Add new company section.</p>
      <p>Create LINQ USA dba Dealsclick and an empty BuySupply company within one organization. Existing operations stay with LINQ. Both companies can access the same product information, with separate vendor accounts and costs.</p>
      <p className="text-sm text-muted-foreground">Existing active staff retain LINQ access. The administrator can grant BuySupply access separately.</p>
      {directory.canInitialize ? <Button disabled={busy} onClick={() => void run(async () => { await request('/api/organization/initialize', 'POST', {}); await load() })}>Set up LINQ and BuySupply</Button> : <p>The master administrator must initialize this organization.</p>}
    </CardContent></Card>}
    {!!directory?.tenants.length && <div className="grid gap-2 sm:max-w-md"><Label htmlFor="organization-select">Organization</Label><select id="organization-select" className="h-10 w-full rounded-md border bg-background px-3" value={tenantId} onChange={e => { setTenantId(e.target.value); setActive(null) }}>{directory.tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>}
    {directory?.initialized && !directory.tenants.length && <p>Your account has no organization access. Ask your administrator to grant access.</p>}
    {directory?.initialized && owner && <Card><CardHeader><CardTitle>Add new company</CardTitle></CardHeader><CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">Create another company in {directory.tenants.find(t => t.id === tenantId)?.name}. It shares your organization’s product information and starts with no orders, connected channels, vendor accounts, or costs.</p>
      <Button disabled={busy} onClick={() => { setError(''); setName(''); setNewCompany(true) }}>Add new company</Button>
    </CardContent></Card>}
    {created && created.tenant_id === tenantId && <Card role="status"><CardContent className="space-y-3 pt-6"><p className="break-words font-medium">{created.name} is ready for setup.</p><p className="text-sm text-muted-foreground">Your current company has not changed. Switch to the new company to open its Orders workspace. File imports are optional under Orders → Tools.</p><Button disabled={busy} onClick={() => void run(async () => { await activateCompany(created); window.location.assign('/orders') })}>Switch to {created.name}</Button><p className="text-sm text-muted-foreground">Grant team access in Settings → Users.</p></CardContent></Card>}
    <div className="grid gap-4 md:grid-cols-2">{directory?.companies.filter(c => c.tenant_id === tenantId).map(company => <Card key={company.id} className={active?.id === company.id ? 'border-primary' : ''}>
      <CardHeader><CardTitle className="break-words">{company.name}</CardTitle></CardHeader><CardContent className="space-y-3">
        <Badge variant="secondary">{company.mode === 'legacy' ? 'Existing operations' : 'Company'}</Badge>
        <p className="text-sm text-muted-foreground">{company.mode === 'legacy' ? 'Existing operations continue in the LINQ workspace. Manual order imports are available here.' : 'Separate orders, channel connections, vendor accounts, and costs. Order imports are available under Orders > Tools.'}</p>
        <Button variant={active?.id === company.id ? 'default' : 'outline'} disabled={busy} onClick={() => void run(() => select(company))}>{active?.id === company.id ? 'Selected' : 'Open company'}</Button>
        {company.mode === 'legacy' && <Button variant="link" disabled={busy} onClick={() => void run(async () => { await activateCompany(company); window.location.assign('/') })}>Open LINQ operations</Button>}
      </CardContent></Card>)}</div>
    {active && active.tenant_id === tenantId && <CompanyDetails key={`${active.tenant_id}/${active.id}`} company={active} owner={directory?.tenants.find(t => t.id === active.tenant_id)?.role === 'owner'} />}
    <Dialog open={newCompany} onOpenChange={open => { if (!busy) setNewCompany(open) }}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Add new company</DialogTitle><DialogDescription>Creates an empty company in {directory?.tenants.find(t => t.id === tenantId)?.name} with access to your organization’s shared product information. Accounts, costs, and transactions are not copied.</DialogDescription></DialogHeader>
      <Label htmlFor="company-name">Company name</Label><Input id="company-name" maxLength={160} value={name} onChange={e => setName(e.target.value)} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter className="pb-[env(safe-area-inset-bottom)]"><Button variant="outline" disabled={busy} onClick={() => setNewCompany(false)}>Cancel</Button><Button disabled={busy || !owner || !name.trim()} onClick={() => void run(async () => { const company = await request<Company>(`/api/organization/tenants/${encodeURIComponent(tenantId)}/companies`, 'POST', { name }); setCreated(company); setNewCompany(false); setName(''); await load(); setActive(company) })}>{busy ? 'Creating…' : 'Create company'}</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>
}

function CompanyDetails({ company, owner }: { company: Company; owner?: boolean }) {
  const base = `/api/organization/tenants/${encodeURIComponent(company.tenant_id)}/companies/${encodeURIComponent(company.id)}`
  const [tab, setTab] = useState('catalog')
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [selectedOnly, setSelectedOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [catalog, setCatalog] = useState<{ rows: Product[]; hasMore: boolean }>({ rows: [], hasMore: false })
  const [accounts, setAccounts] = useState<Account[]>([])
  const [activity, setActivity] = useState<{ id: string; action: string; created_at: string }[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const [edit, setEdit] = useState<Product | null>(null)
  const [sku, setSku] = useState('')
  const [costs, setCosts] = useState<Cost[]>([])
  const [accountId, setAccountId] = useState('')
  const [unitCost, setUnitCost] = useState('')
  const [uom, setUom] = useState('Each')
  const [accountDialog, setAccountDialog] = useState(false)
  const [supplierName, setSupplierName] = useState('')
  const [accountReference, setAccountReference] = useState('')
  useEffect(() => {
    let cancelled = false; setError(''); setBusy(true)
    Promise.all([
      request<{ rows: Product[]; hasMore: boolean }>(`${base}/catalog?q=${encodeURIComponent(search)}&page=${page}&selected=${selectedOnly ? 1 : 0}`),
      request<{ rows: Account[] }>(`${base}/vendor-accounts`),
      request<{ rows: typeof activity }>(`${base}/activity`)
    ]).then(([products, vendors, events]) => { if (!cancelled) { setCatalog(products); setAccounts(vendors.rows); setActivity(events.rows) } }).catch(e => { if (!cancelled) setError(e.message) }).finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [base, search, page, selectedOnly, revision])
  async function run(work: () => Promise<void>) {
    setBusy(true); setError('')
    try { await work(); setRevision(n => n + 1) } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save.') } finally { setBusy(false) }
  }
  async function openProduct(product: Product) {
    setBusy(true); setError('')
    try {
      const result = await request<{ rows: Cost[] }>(`${base}/costs?productId=${encodeURIComponent(product.product_id)}`)
      setCosts(result.rows); setEdit(product); setSku(product.company_sku || product.source_sku); setAccountId(''); setUnitCost(''); setUom(product.uom || 'Each')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load product.') } finally { setBusy(false) }
  }
  return <section className="min-w-0 space-y-4">
    <h2 className="break-words text-xl font-semibold">{company.name}</h2>
    {company.mode === 'legacy' && <p className="text-sm text-muted-foreground">This catalog view prepares company records. LINQ’s existing operational pricing remains in its current product workspace.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button variant="outline" disabled={busy} onClick={() => void run(async () => { await activateCompany(company); window.location.assign("/orders/tools") })}>Open Order Tools for {company.name}</Button>
    <Tabs value={tab} onValueChange={setTab}><TabsList className="flex h-auto flex-wrap justify-start"><TabsTrigger value="catalog">Catalog</TabsTrigger><TabsTrigger value="accounts">Vendor accounts</TabsTrigger><TabsTrigger value="activity">Activity</TabsTrigger></TabsList>
      <TabsContent value="catalog" className="space-y-4">
        <p className="text-sm text-muted-foreground">Shared product identity and content. Select a product to add a company SKU and its negotiated supplier cost. Blank cost means unknown.</p>
        <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); setPage(1); setSearch(query) }}><Input className="min-w-0 flex-1" aria-label="Search shared catalog" placeholder="SKU, UPC, or title" value={query} onChange={e => setQuery(e.target.value)} /><Button disabled={busy}>Search</Button><Button type="button" variant="outline" onClick={() => { setSelectedOnly(v => !v); setPage(1) }}>{selectedOnly ? 'Show shared catalog' : 'Show selected products'}</Button></form>
        {busy && <p role="status" className="text-sm">Loading…</p>}
        <div className="space-y-2">{catalog.rows.map(product => <div key={product.product_id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
          <div className="min-w-0 flex-1"><p className="break-words font-medium">{product.company_sku || product.source_sku}</p><p className="break-words text-sm">{product.title}</p><p className="break-words text-xs text-muted-foreground">{product.brand || 'No brand'} · UPC: {product.barcode || 'Not recorded'}</p></div>
          <div className="flex shrink-0 items-center gap-2">{product.selected && <Badge variant="secondary">Selected</Badge>}<Button size="sm" variant="outline" disabled={busy} onClick={() => void openProduct(product)}>{owner ? 'Configure' : 'View'}</Button></div>
        </div>)}</div>
        {!busy && !catalog.rows.length && <p>No products found.</p>}
        <div className="flex items-center gap-3"><Button variant="outline" disabled={busy || page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button><span className="text-sm">Page {page}</span><Button variant="outline" disabled={busy || !catalog.hasMore} onClick={() => setPage(p => p + 1)}>Next</Button></div>
      </TabsContent>
      <TabsContent value="accounts" className="space-y-3"><p className="text-sm text-muted-foreground">These supplier accounts and costs belong only to {company.name}. Enter account references here, not passwords or API keys.</p>
        {owner && <Button onClick={() => setAccountDialog(true)}>Add vendor account</Button>}
        {accounts.map(a => <div key={a.id} className="rounded-md border p-3"><p className="break-words font-medium">{a.supplier_name}</p><p className="break-words text-sm text-muted-foreground">{a.account_reference}</p></div>)}
        {!accounts.length && <p>No vendor accounts configured.</p>}
      </TabsContent>
      <TabsContent value="activity" className="space-y-2"><p className="text-sm text-muted-foreground">Latest 100 company setup changes.</p>{activity.map(event => <div key={event.id} className="flex flex-wrap justify-between gap-2 rounded-md border p-3 text-sm"><span>{event.action.replaceAll('_', ' ')}</span><time>{new Date(event.created_at).toLocaleString()}</time></div>)}</TabsContent>
    </Tabs>
    <Dialog open={Boolean(edit)} onOpenChange={open => { if (!open) setEdit(null) }}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Company product</DialogTitle><DialogDescription className="break-words">{edit?.title}</DialogDescription></DialogHeader>
      <Label htmlFor="company-sku">Company SKU</Label><Input id="company-sku" value={sku} disabled={!owner} onChange={e => setSku(e.target.value)} />
      <div className="space-y-2">{costs.map(cost => <p key={cost.vendor_account_id} className="break-words text-sm">{cost.supplier_name}: {cost.unit_cost === null ? 'Unknown cost' : `${company.currency} ${cost.unit_cost}`} / {cost.uom}</p>)}</div>
      {owner && <><Label htmlFor="cost-account">Vendor account (optional)</Label><select id="cost-account" className="h-10 w-full rounded-md border bg-background px-3" value={accountId} onChange={e => { setAccountId(e.target.value); const cost = costs.find(c => c.vendor_account_id === e.target.value); setUnitCost(cost?.unit_cost ?? ''); setUom(cost?.uom || edit?.uom || 'Each') }}><option value="">Save catalog selection only</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.supplier_name} — {a.account_reference}</option>)}</select>
      {accountId && <><Label htmlFor="unit-cost">Negotiated cost ({company.currency})</Label><Input id="unit-cost" inputMode="decimal" value={unitCost} onChange={e => setUnitCost(e.target.value)} placeholder="Unknown" /><Label htmlFor="cost-uom">Cost unit / pack</Label><Input id="cost-uom" value={uom} onChange={e => setUom(e.target.value)} /></>}</>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter className="pb-[env(safe-area-inset-bottom)]"><Button variant="outline" onClick={() => setEdit(null)}>Close</Button>{owner && <Button disabled={busy || !sku.trim() || Boolean(accountId && !uom.trim())} onClick={() => void run(async () => {
        if (!edit) return
        await request(`${base}/catalog`, 'PUT', { productId: edit.product_id, sku, ...(accountId ? { cost: { vendorAccountId: accountId, unitCost: unitCost || null, uom } } : {}) })
        setEdit(null)
      })}>Save</Button>}</DialogFooter>
    </DialogContent></Dialog>
    <Dialog open={accountDialog} onOpenChange={setAccountDialog}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle>Add vendor account</DialogTitle><DialogDescription>{company.name}</DialogDescription></DialogHeader><Label htmlFor="supplier-name">Supplier name</Label><Input id="supplier-name" value={supplierName} onChange={e => setSupplierName(e.target.value)} /><Label htmlFor="account-reference">Account reference</Label><Input id="account-reference" value={accountReference} onChange={e => setAccountReference(e.target.value)} />{error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button variant="outline" onClick={() => setAccountDialog(false)}>Cancel</Button><Button disabled={busy || !supplierName.trim() || !accountReference.trim()} onClick={() => void run(async () => { await request(`${base}/vendor-accounts`, 'POST', { supplierName, accountReference }); setAccountDialog(false); setSupplierName(''); setAccountReference('') })}>Save account</Button></DialogFooter></DialogContent></Dialog>
  </section>
}
