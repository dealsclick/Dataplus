import { Settings, ShoppingBag } from 'lucide-react'
import { CompanyWorkspace } from './company-workspace'
import { settingsTabItems } from './settings-navigation'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Label } from '@/components/ui/label'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'

// Company settings must remain accessible without loading LINQ-only operational APIs.
export function CompaniesSettings() {
  const navigate = (tab: string) => { if (tab !== 'companies') window.location.assign(`/settings?tab=${encodeURIComponent(tab)}`) }
  return <TooltipProvider><SidebarProvider defaultOpen>
    <Sidebar collapsible="icon"><SidebarHeader className="p-4"><p className="font-semibold group-data-[collapsible=icon]:hidden">DataPlus</p></SidebarHeader><SidebarContent><SidebarGroup><SidebarGroupLabel>Operations</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>
      <SidebarMenuItem><SidebarMenuButton asChild tooltip="Orders"><a href="/orders"><ShoppingBag/><span>Orders</span></a></SidebarMenuButton></SidebarMenuItem>
      <SidebarMenuItem><SidebarMenuButton asChild isActive tooltip="Settings"><a href="/settings?tab=companies"><Settings/><span>Settings</span></a></SidebarMenuButton></SidebarMenuItem>
    </SidebarMenu></SidebarGroupContent></SidebarGroup></SidebarContent></Sidebar>
    <SidebarInset className="min-w-0 bg-muted/35"><header className="flex items-center gap-3 border-b bg-background p-4"><SidebarTrigger/><h1 className="text-xl font-semibold">System Settings</h1></header>
      <main className="min-w-0 space-y-5 p-4 md:p-6">
        <Tabs value="companies" onValueChange={navigate} className="min-w-0">
          <div className="space-y-2 md:hidden"><Label htmlFor="company-settings-section">Settings section</Label><select id="company-settings-section" value="companies" onChange={e => navigate(e.target.value)} className="h-10 w-full rounded-md border bg-background px-3">{settingsTabItems.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}</select></div>
          <TabsList className="hidden group-data-horizontal/tabs:h-auto w-full flex-wrap justify-start gap-1 md:flex">{settingsTabItems.map(tab => <TabsTrigger key={tab.id} value={tab.id}>{tab.label}</TabsTrigger>)}</TabsList>
          <TabsContent value="companies" className="min-w-0 pt-4"><CompanyWorkspace/></TabsContent>
        </Tabs>
      </main>
    </SidebarInset>
  </SidebarProvider></TooltipProvider>
}
