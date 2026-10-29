import { useState, type ComponentType, type ReactNode } from "react"
import { ArrowLeft, MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { cn } from "@/lib/utils"
import { numberLabel } from "../lib/client-api"

export function HistoryBackButton({ fallback, label, size = "sm", className }: { fallback: string; label: string; size?: "default" | "sm" | "lg" | "icon"; className?: string }) {
  const goBack = () => {
    let hasSameOriginReferrer = false
    try { hasSameOriginReferrer = Boolean(document.referrer) && new URL(document.referrer).origin === window.location.origin } catch { hasSameOriginReferrer = false }
    const state = window.history.state as { dataplusFrom?: string } | null
    if (window.history.length > 1 && (Boolean(state?.dataplusFrom) || hasSameOriginReferrer)) window.history.back()
    else window.location.assign(fallback)
  }
  return <Button type="button" size={size} variant="outline" className={className} onClick={goBack}><ArrowLeft className="size-4" /> {label}</Button>
}

export function MetricCard({ label, value, icon: Icon }: { label: string; value: string | number; icon: ComponentType<{ className?: string }> }) {
  return <Card id="vendor-feed-schedules"><CardContent className="flex items-center justify-between gap-4 p-4"><div><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tracking-tight">{typeof value === "number" ? numberLabel(value) : value}</p></div><div className="grid size-10 place-items-center rounded-md bg-muted"><Icon className="size-5 text-muted-foreground" /></div></CardContent></Card>
}

type ContextAction = { id: string; label: string; description?: string; icon?: ReactNode; onSelect: () => void; disabled?: boolean; group?: "Primary" | "Utilities" | "Danger zone"; destructive?: boolean }

export function ContextActions({ actions, label = "Actions", disabled = false }: { actions: ContextAction[]; label?: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const groups: Array<ContextAction["group"]> = ["Primary", "Utilities", "Danger zone"]
  const grouped = groups.map((group) => ({ group, actions: actions.filter((action) => (action.group || "Primary") === group) })).filter((entry) => entry.actions.length)
  return <><Button size="sm" disabled={disabled} onClick={() => setOpen(true)} className="border border-blue-700 bg-blue-600 font-semibold text-white shadow-sm hover:bg-blue-700 dark:border-blue-400 dark:bg-blue-500 dark:hover:bg-blue-400"><MoreHorizontal className="size-4" /> {label}</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="w-[calc(100%-2rem)] max-w-[34rem] gap-0 overflow-hidden p-0"><DialogHeader className="border-b px-4 py-3"><DialogTitle>{label}</DialogTitle><DialogDescription>Search or choose an action for this workspace.</DialogDescription></DialogHeader><Command><CommandInput placeholder="Find an action..." /><CommandList className="max-h-[min(60vh,28rem)]"><CommandEmpty>No actions match your search.</CommandEmpty>{grouped.map((entry, index) => <div key={entry.group}>{index > 0 && <CommandSeparator />}<CommandGroup heading={entry.group}>{entry.actions.map((action) => <CommandItem key={action.id} value={`${action.label} ${action.description || ""}`} disabled={action.disabled} onSelect={() => { if (action.disabled) return; setOpen(false); action.onSelect() }} className={action.destructive ? "text-destructive data-[selected=true]:bg-destructive/10 data-[selected=true]:text-destructive" : ""}><span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md border bg-muted/50", action.destructive && "border-destructive/30 bg-destructive/5")}>{action.icon || <MoreHorizontal className="size-4" />}</span><span className="min-w-0 flex-1"><span className="block font-medium">{action.label}</span>{action.description && <span className="block truncate text-xs text-muted-foreground">{action.description}</span>}</span></CommandItem>)}</CommandGroup></div>)}</CommandList></Command></DialogContent></Dialog></>
}

function DetailBreadcrumb({ items }: { items: Array<{ label: string; href?: string }> }) {
  return <Breadcrumb><BreadcrumbList>{items.map((item, index) => <div key={`${item.label}-${index}`} className="contents"><BreadcrumbItem>{item.href ? <BreadcrumbLink asChild><a href={item.href}>{item.label}</a></BreadcrumbLink> : <BreadcrumbPage>{item.label}</BreadcrumbPage>}</BreadcrumbItem>{index < items.length - 1 && <BreadcrumbSeparator />}</div>)}</BreadcrumbList></Breadcrumb>
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between"><div className="min-w-0"><DetailBreadcrumb items={[{ label: "DataPlus", href: "/" }, { label: eyebrow }]} /><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{eyebrow}</p><h2 className="text-2xl font-semibold tracking-tight">{title}</h2><p className="max-w-3xl text-sm text-muted-foreground">{description}</p></div>{action && <div className="w-full sm:w-auto">{action}</div>}</div>
}

export function Detail({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border bg-background p-2"><p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p><p className="break-words font-medium">{value}</p></div>
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid gap-1.5"><Label className="text-xs font-bold text-muted-foreground">{label}</Label>{children}</div>
}

export function ToggleField({ label, description, checked, disabled, onCheckedChange }: { label: string; description?: string; checked: boolean; disabled?: boolean; onCheckedChange: (value: boolean) => void }) {
  return <div className="flex items-center justify-between gap-4 rounded-md border bg-background p-3"><div className="min-w-0"><Label className="text-sm font-medium">{label}</Label>{description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}</div><Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} /></div>
}
