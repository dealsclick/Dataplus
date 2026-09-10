import { SavedOrderTemplates } from './saved-order-templates'
import { useEffect, useState } from 'react'
import { ManualOrderImporter } from './manual-order-importer'
import { OrderImportTemplates } from './order-import-templates'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { currentCompany } from './company-switcher'
import type { CompanyDirectory } from './company-switcher'

type Company = { tenant_id: string; id: string; name: string; currency: string; mode: string }
type Directory = { initialized: boolean; tenants: { id: string; name: string; role: string }[]; companies: Company[]; selection: { tenantId: string; companyId: string } | null }

export function OrderImportsWorkspace() {
  const [directory, setDirectory] = useState<Directory | null>(null)
  const [companyKey, setCompanyKey] = useState('')
  const [error, setError] = useState('')
  const key = (company: Company) => JSON.stringify([company.tenant_id, company.id])
  useEffect(() => {
    let cancelled = false
    fetch('/api/organization').then(async response => {
      const data = await response.json()
      if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to DataPlus to open Order Tools.' : data.error || 'Unable to load company access.')
      return data as Directory
    }).then(data => {
      if (cancelled) return
      setDirectory(data)
      const company = currentCompany(data as CompanyDirectory)
      if (company) setCompanyKey(key(company))
    }).catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [])
  const company = directory?.companies.find(c => key(c) === companyKey)
  return <section className="min-w-0 space-y-5">
      <div><h2 className="text-xl font-semibold">Order Tools</h2><p className="text-sm text-muted-foreground">Order imports, templates, and import history by company.</p></div>
        {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
        {!directory && !error && <p role="status">Loading companies…</p>}
        {directory && !directory.initialized && <div className="space-y-3 rounded-md border bg-background p-4"><p>Set up your organization and companies before importing orders.</p><Button asChild><a href="/settings?tab=companies">Set up companies</a></Button></div>}
        {company && <p className="text-sm text-muted-foreground">Importing into <strong>{company.name}</strong>. Use the company switcher above to change the destination. Imports, costs, and reports stay separate for each company.</p>}
        {directory?.initialized && !directory.companies.length && <p>No companies are assigned to your account. Ask your organization owner for access.</p>}
        <Tabs defaultValue="import" className="min-w-0">
          <TabsList><TabsTrigger value="import">Import orders</TabsTrigger><TabsTrigger value="templates">Templates</TabsTrigger></TabsList>
          <TabsContent value="import" className="min-w-0 space-y-4 pt-3">
            {directory?.initialized && !company && <p className="text-sm text-muted-foreground">Use the company switcher above to upload orders or review import history.</p>}
            {company && <ManualOrderImporter key={companyKey} base={`/api/organization/tenants/${encodeURIComponent(company.tenant_id)}/companies/${encodeURIComponent(company.id)}`} companyName={company.name} currency={company.currency} owner={directory?.tenants.find(t => t.id === company.tenant_id)?.role === 'owner'}/>}
          </TabsContent>
          <TabsContent value="templates" className="min-w-0 pt-3">{company&&<SavedOrderTemplates key={companyKey} base={`/api/organization/tenants/${encodeURIComponent(company.tenant_id)}/companies/${encodeURIComponent(company.id)}`} companyName={company.name} owner={directory?.tenants.find(t=>t.id===company.tenant_id)?.role==='owner'}/>}<OrderImportTemplates/></TabsContent>
        </Tabs>
  </section>
}
