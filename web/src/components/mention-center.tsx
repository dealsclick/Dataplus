import { useCallback, useEffect, useMemo, useState } from "react"
import { AtSign, Check, CheckCheck, Circle, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { api } from "@/lib/client-api"
import { cn } from "@/lib/utils"

type OrderMention = {
  id: string
  orderId: string
  orderNumber?: string
  text: string
  authorName?: string
  status: "open" | "acknowledged" | "completed"
  createdAt?: string
}

type LatestActiveMention = { id: string; createdAt?: string } | null
type MentionResponse = { mentions: OrderMention[]; total: number; activeCount: number; latestActiveMention: LatestActiveMention; viewerId: string }

function mentionSeenKey(viewerId: string) {
  return `dataplus-mentions-seen:${viewerId}`
}

function mentionDate(value = "") {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Just now"
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date)
}

export function MentionCenter() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<"active" | "completed">("active")
  const [items, setItems] = useState<OrderMention[]>([])
  const [activeCount, setActiveCount] = useState(0)
  const [latestActiveMention, setLatestActiveMention] = useState<LatestActiveMention>(null)
  const [viewerId, setViewerId] = useState("")
  const [hasNewMention, setHasNewMention] = useState(false)
  const [loading, setLoading] = useState(false)

  const markLatestSeen = useCallback((latest: LatestActiveMention, userId: string) => {
    if (!latest?.id || !userId) return
    window.localStorage.setItem(mentionSeenKey(userId), latest.id)
    setHasNewMention(false)
  }, [])

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const result = await api<MentionResponse>(`/api/mentions?status=${status}&limit=100`)
      setItems(result.mentions || [])
      setActiveCount(Number(result.activeCount || 0))
      setLatestActiveMention(result.latestActiveMention || null)
      setViewerId(result.viewerId || "")
      const latest = result.latestActiveMention || null
      if (open) markLatestSeen(latest, result.viewerId || "")
      else setHasNewMention(Boolean(latest?.id && result.viewerId && window.localStorage.getItem(mentionSeenKey(result.viewerId)) !== latest.id))
    } catch (error) {
      if (!quiet) toast.error(error instanceof Error ? error.message : "Unable to load mentions.")
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [markLatestSeen, open, status])

  useEffect(() => {
    void load(true)
    const timer = window.setInterval(() => void load(true), 30_000)
    const refresh = () => void load(true)
    window.addEventListener("dataplus:mentions-changed", refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("dataplus:mentions-changed", refresh)
    }
  }, [load])

  useEffect(() => { if (open) void load() }, [open, load])

  async function updateStatus(item: OrderMention, nextStatus: "acknowledged" | "completed") {
    try {
      await api(`/api/mentions/${encodeURIComponent(item.id)}/status`, { method: "PATCH", body: JSON.stringify({ status: nextStatus }) })
      toast.success(nextStatus === "completed" ? "Mention marked complete." : "Mention acknowledged.")
      window.dispatchEvent(new CustomEvent("dataplus:mentions-changed"))
      await load(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update this mention.")
    }
  }

  const badgeLabel = useMemo(() => activeCount > 99 ? "99+" : String(activeCount), [activeCount])
  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (nextOpen) markLatestSeen(latestActiveMention, viewerId)
  }

  return <Sheet open={open} onOpenChange={handleOpenChange}>
    <SheetTrigger asChild>
      <Button variant="ghost" size="icon" className={cn("relative rounded-full transition-[color,background-color,border-color,box-shadow] sm:border sm:bg-background", hasNewMention && "animate-pulse border-primary bg-primary/15 text-primary shadow-lg shadow-primary/50 motion-reduce:animate-none")} title={hasNewMention ? "New mention" : "My mentions"} aria-label={`${activeCount} active mentions${hasNewMention ? ", new mention available" : ""}`}>
        <AtSign className="size-4" />
        {activeCount > 0 ? <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[9px] font-semibold text-primary-foreground">{badgeLabel}</span> : null}
      </Button>
    </SheetTrigger>
    <SheetContent side="right" className="flex h-[100dvh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
      <SheetHeader className="border-b px-5 py-4 text-left">
        <SheetTitle>My mentions</SheetTitle>
        <SheetDescription>Order follow-ups where a teammate tagged your username.</SheetDescription>
        <Tabs value={status} onValueChange={(value) => setStatus(value as "active" | "completed")} className="pt-2">
          <TabsList className="grid w-full grid-cols-2"><TabsTrigger value="active">Active</TabsTrigger><TabsTrigger value="completed">Completed</TabsTrigger></TabsList>
        </Tabs>
      </SheetHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="divide-y">
          {items.map((item) => <article key={item.id} className="grid gap-3 px-5 py-4">
            <div className="flex items-start gap-3">
              <span className={cn("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border", item.status === "open" ? "bg-blue-500/10 text-blue-600" : item.status === "acknowledged" ? "bg-amber-500/10 text-amber-600" : "bg-emerald-500/10 text-emerald-600")}>
                {item.status === "open" ? <Circle className="size-3.5 fill-current" /> : item.status === "acknowledged" ? <Check className="size-4" /> : <CheckCheck className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <button type="button" className="text-left text-sm font-semibold text-primary hover:underline" onClick={() => window.location.assign(`/orders/${encodeURIComponent(item.orderId)}`)}>Order {item.orderNumber || item.orderId}</button>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{item.text}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><span>{item.authorName || "DataPlus user"}</span><span aria-hidden>·</span><span>{mentionDate(item.createdAt)}</span><Badge variant="outline" className="capitalize">{item.status}</Badge></div>
              </div>
            </div>
            {item.status !== "completed" ? <div className="flex justify-end gap-2">
              {item.status === "open" ? <Button size="sm" variant="outline" onClick={() => void updateStatus(item, "acknowledged")}><Check className="size-4" /> Acknowledge</Button> : null}
              <Button size="sm" onClick={() => void updateStatus(item, "completed")}><CheckCheck className="size-4" /> Complete</Button>
            </div> : null}
          </article>)}
          {!loading && items.length === 0 ? <div className="grid min-h-64 place-items-center px-6 text-center"><div><AtSign className="mx-auto mb-3 size-8 text-muted-foreground" /><p className="font-medium">No {status} mentions</p><p className="mt-1 text-sm text-muted-foreground">Use @username in an order note to assign a follow-up.</p></div></div> : null}
          {loading ? <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading mentions...</div> : null}
        </div>
      </ScrollArea>
    </SheetContent>
  </Sheet>
}
