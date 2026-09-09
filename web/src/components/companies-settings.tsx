import { CompanyWorkspace } from './company-workspace'
import { settingsTabItems } from './settings-navigation'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Label } from '@/components/ui/label'

// Company settings must remain accessible without loading LINQ-only operational APIs.
export function CompaniesSettings() {
  const navigate = (tab: string) => { if (tab !== 'companies') window.location.assign(`/settings?tab=${encodeURIComponent(tab)}`) }
  return <section className="min-w-0 space-y-5">
    <h2 className="text-xl font-semibold">System Settings</h2>
        <Tabs value="companies" onValueChange={navigate} className="min-w-0">
          <div className="space-y-2 md:hidden"><Label htmlFor="company-settings-section">Settings section</Label><select id="company-settings-section" value="companies" onChange={e => navigate(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3">{settingsTabItems.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}</select></div>
          <TabsList className="hidden group-data-horizontal/tabs:h-auto w-full flex-wrap justify-start gap-1 md:flex">{settingsTabItems.map(tab => <TabsTrigger key={tab.id} value={tab.id}>{tab.label}</TabsTrigger>)}</TabsList>
          <TabsContent value="companies" className="min-w-0 pt-4"><CompanyWorkspace/></TabsContent>
        </Tabs>
  </section>
}
