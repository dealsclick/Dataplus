import { useEffect, useState } from 'react'
import { Settings, ShoppingBag } from 'lucide-react'
import { orderSidebarItems } from './order-navigation'
import { ManualOrderImporter } from './manual-order-importer'
import { OrderImportTemplates } from './order-import-templates'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'

type Company = { tenant_id: string; id: string; name: string; currency: string }
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
      const params = new URLSearchParams(window.location.search)
      const requested = params.has('companyId') || params.has('tenantId')
      const company = data.companies.find(c => c.id === (requested ? params.get('companyId') : data.selection?.companyId) && c.tenant_id === (requested ? params.get('tenantId') : data.selection?.tenantId))
      if (company) setCompanyKey(key(company))
      else if (requested) setError('This company is unavailable to your account. Choose an authorized company below.')
    }).catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [])
  const company = directory?.companies.find(c => key(c) === companyKey)
  function select(value: string) {
    setCompanyKey(value); setError('')
    const next = directory?.companies.find(c => key(c) === value)
    const query = next ? `?${new URLSearchParams({ tenantId: next.tenant_id, companyId: next.id })}` : ''
    // Import destination is local to this workspace, not a change to other tabs' operational company.
    window.history.replaceState({}, '', `/orders/tools${query}`)
  }
  return <TooltipProvider><SidebarProvider defaultOpen>
    <Sidebar collapsible="icon"><SidebarHeader className="p-4"><p className="font-semibold group-data-[collapsible=icon]:hidden">DataPlus</p></SidebarHeader><SidebarContent><SidebarGroup><SidebarGroupLabel>Operations</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>
      <SidebarMenuItem><SidebarMenuButton asChild isActive tooltip="Orders"><a href="/orders"><ShoppingBag/><span>Orders</span></a></SidebarMenuButton>
        <SidebarMenuSub>{orderSidebarItems.map(item => <SidebarMenuSubItem key={item.path}><SidebarMenuSubButton asChild isActive={item.path === '/orders/tools'}><a href={item.path}><item.icon/><span>{item.label}</span></a></SidebarMenuSubButton></SidebarMenuSubItem>)}</SidebarMenuSub>
      </SidebarMenuItem>
      <SidebarMenuItem><SidebarMenuButton asChild tooltip="Settings"><a href="/settings?tab=companies"><Settings/><span>Settings</span></a></SidebarMenuButton></SidebarMenuItem>
    </SidebarMenu></SidebarGroupContent></SidebarGroup></SidebarContent></Sidebar>
    <SidebarInset className="min-w-0 bg-muted/35"><header className="flex items-center gap-3 border-b bg-background p-4"><SidebarTrigger/><div className="min-w-0"><h1 className="text-xl font-semibold">Order Tools</h1><p className="text-sm text-muted-foreground">Order imports, templates, and import history by company.</p></div></header>
      <main className="min-w-0 space-y-5 p-4 md:p-6">
        {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
        {!directory && !error && <p role="status">Loading companies…</p>}
        {directory && !directory.initialized && <div className="space-y-3 rounded-md border bg-background p-4"><p>Set up your organization and companies before importing orders.</p><Button asChild><a href="/settings?tab=companies">Set up companies</a></Button></div>}
        {directory?.initialized && <div className="max-w-xl space-y-2"><Label htmlFor="import-destination">Import company</Label><select id="import-destination" className="h-10 w-full min-w-0 rounded-md border bg-background px-3" value={companyKey} onChange={e => select(e.target.value)}><option value="">Select company</option>{directory.companies.map(c => <option key={key(c)} value={key(c)}>{directory.tenants.length > 1 ? `${directory.tenants.find(t => t.id === c.tenant_id)?.name} / ` : ''}{c.name}</option>)}</select><p className="text-xs text-muted-foreground">Each company has separate imports, historical costs, and reporting. Uploaded batches remain available in that company’s import history.</p></div>}
        {directory?.initialized && !directory.companies.length && <p>No companies are assigned to your account. Ask your organization owner for access.</p>}
        <Tabs defaultValue="import" className="min-w-0">
          <TabsList><TabsTrigger value="import">Import orders</TabsTrigger><TabsTrigger value="templates">Templates</TabsTrigger></TabsList>
          <TabsContent value="import" className="min-w-0 space-y-4 pt-3">
            {directory?.initialized && !company && <p className="text-sm text-muted-foreground">Select a company above to upload orders or review import history.</p>}
            {company && <ManualOrderImporter key={companyKey} base={`/api/organization/tenants/${encodeURIComponent(company.tenant_id)}/companies/${encodeURIComponent(company.id)}`} companyName={company.name} currency={company.currency} owner={directory?.tenants.find(t => t.id === company.tenant_id)?.role === 'owner'}/>}
          </TabsContent>
          <TabsContent value="templates" className="min-w-0 pt-3"><OrderImportTemplates/></TabsContent>
        </Tabs>
      </main>
    </SidebarInset>
  </SidebarProvider></TooltipProvider>
}
