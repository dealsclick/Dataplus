import { isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { AlertCircle, Bell, Check, CheckCheck, CircleAlert, Info, Loader2, Search } from "lucide-react"
import { useSonner } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

type NotificationSeverity = "success" | "info" | "warning" | "error"

type SystemNotification = {
  id: string
  severity: NotificationSeverity
  category: string
  title: string
  message?: string
  source?: string
  entityType?: string
  entityId?: string
  actionUrl?: string
  actorName?: string
  readAt?: string
  createdAt?: string
}

type NotificationResponse = {
  notifications: SystemNotification[]
  unreadCount: number
  total: number
  hasMore: boolean
}

function reactNodeText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node).trim()
  if (Array.isArray(node)) return node.map(reactNodeText).filter(Boolean).join(" ").trim()
  if (isValidElement<{ children?: ReactNode }>(node)) return reactNodeText(node.props.children)
  return ""
}

function captureSessionId() {
  const key = "dataplus-notification-capture-session"
  const saved = window.sessionStorage.getItem(key)
  if (saved) return saved
  const next = window.crypto.randomUUID()
  window.sessionStorage.setItem(key, next)
  return next
}

export function NotificationCapture() {
  const { toasts } = useSonner()
  const seen = useRef(new Set<string>())
  const sessionId = useRef("")

  useEffect(() => {
    sessionId.current = captureSessionId()
  }, [])

  useEffect(() => {
    if (!sessionId.current) return
    for (const item of toasts) {
      if (item.delete || item.type === "loading") continue
      const title = reactNodeText(typeof item.title === "function" ? item.title() : item.title)
      const message = reactNodeText(typeof item.description === "function" ? item.description() : item.description)
      if (!title && !message) continue
      const severity: NotificationSeverity = item.type === "error" || item.type === "warning" || item.type === "success" || item.type === "info"
        ? item.type
        : "info"
      const captureKey = `${sessionId.current}:${String(item.id)}:${severity}:${title}:${message}`
      if (seen.current.has(captureKey)) continue
      seen.current.add(captureKey)
      void fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title || "Notification",
          message,
          severity,
          category: "user-message",
          source: "web-toast",
          clientEventId: captureKey,
        }),
      }).then((response) => {
        if (response.ok) window.dispatchEvent(new CustomEvent("dataplus:notifications-changed"))
      }).catch(() => undefined)
    }
  }, [toasts])

  return null
}

function notificationDate(value = "") {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Just now"
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date)
}

function SeverityIcon({ severity }: { severity: NotificationSeverity }) {
  if (severity === "error") return <AlertCircle className="size-4 text-destructive" />
  if (severity === "warning") return <CircleAlert className="size-4 text-amber-500" />
  if (severity === "success") return <Check className="size-4 text-emerald-500" />
  return <Info className="size-4 text-blue-500" />
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<SystemNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [total, setTotal] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [query, setQuery] = useState("")

  async function load(options: { append?: boolean; quiet?: boolean } = {}) {
    if (!options.quiet) setLoading(true)
    try {
      const offset = options.append ? items.length : 0
      const params = new URLSearchParams({ limit: "50", offset: String(offset) })
      if (unreadOnly) params.set("unread", "1")
      if (query.trim()) params.set("q", query.trim())
      const response = await fetch(`/api/notifications?${params}`)
      if (!response.ok) return
      const result = await response.json() as NotificationResponse
      setItems((current) => options.append ? [...current, ...result.notifications] : result.notifications)
      setUnreadCount(result.unreadCount || 0)
      setTotal(result.total || 0)
      setHasMore(Boolean(result.hasMore))
    } finally {
      if (!options.quiet) setLoading(false)
    }
  }

  useEffect(() => {
    void load({ quiet: true })
    const timer = window.setInterval(() => void load({ quiet: true }), 30_000)
    const refresh = () => void load({ quiet: true })
    window.addEventListener("dataplus:notifications-changed", refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener("dataplus:notifications-changed", refresh)
    }
  }, [unreadOnly, query])

  useEffect(() => {
    if (open) void load()
  }, [open, unreadOnly, query])

  async function markRead(item: SystemNotification) {
    if (!item.readAt) {
      const response = await fetch(`/api/notifications/${encodeURIComponent(item.id)}/read`, { method: "POST" })
      if (response.ok) {
        setItems((current) => current.map((row) => row.id === item.id ? { ...row, readAt: new Date().toISOString() } : row))
        setUnreadCount((count) => Math.max(0, count - 1))
      }
    }
    if (item.actionUrl) window.location.assign(item.actionUrl)
  }

  async function markAllRead() {
    const response = await fetch("/api/notifications/read-all", { method: "POST" })
    if (!response.ok) return
    const now = new Date().toISOString()
    setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt || now })))
    setUnreadCount(0)
  }

  const label = useMemo(() => unreadCount > 99 ? "99+" : String(unreadCount), [unreadCount])

  return <Sheet open={open} onOpenChange={setOpen}>
    <SheetTrigger asChild>
      <Button variant="ghost" size="icon" className="relative rounded-full sm:border sm:bg-background" title="Notifications" aria-label={`${unreadCount} unread notifications`}>
        <Bell className="size-4" />
        {unreadCount > 0 ? <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-destructive px-1 text-[9px] font-semibold text-destructive-foreground">{label}</span> : null}
      </Button>
    </SheetTrigger>
    <SheetContent side="right" className="flex h-[100dvh] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
      <SheetHeader className="border-b px-5 py-4 text-left">
        <div className="flex items-start justify-between gap-3 pr-8">
          <div><SheetTitle>Notifications</SheetTitle><SheetDescription>Company messages and private assignments visible to your account.</SheetDescription></div>
          {unreadCount > 0 ? <Button variant="outline" size="sm" onClick={() => void markAllRead()}><CheckCheck className="size-4" /> Mark all read</Button> : null}
        </div>
        <div className="flex gap-2 pt-2">
          <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-8" placeholder="Search messages, users, jobs..." /></div>
          <Button variant={unreadOnly ? "default" : "outline"} onClick={() => setUnreadOnly((current) => !current)}>Unread</Button>
        </div>
      </SheetHeader>
      <ScrollArea className="min-h-0 flex-1">
        <div className="divide-y">
          {items.map((item) => <button key={item.id} type="button" onClick={() => void markRead(item)} className={cn("flex w-full items-start gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/60", !item.readAt && "bg-primary/[0.045]")}>
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full border bg-background"><SeverityIcon severity={item.severity} /></span>
            <span className="min-w-0 flex-1">
              <span className="flex items-start justify-between gap-3"><span className={cn("text-sm", !item.readAt ? "font-semibold" : "font-medium")}>{item.title}</span>{!item.readAt ? <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" /> : null}</span>
              {item.message && item.message !== item.title ? <span className="mt-1 block whitespace-pre-wrap text-sm text-muted-foreground">{item.message}</span> : null}
              <span className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>{item.actorName || "DataPlus system"}</span><span aria-hidden>·</span><span>{notificationDate(item.createdAt)}</span>
                {item.source ? <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">{item.source}</Badge> : null}
                {item.entityId ? <span className="font-mono">{item.entityId}</span> : null}
              </span>
            </span>
          </button>)}
          {!loading && items.length === 0 ? <div className="grid min-h-64 place-items-center px-6 text-center"><div><Bell className="mx-auto mb-3 size-8 text-muted-foreground" /><p className="font-medium">No messages found</p><p className="mt-1 text-sm text-muted-foreground">Operational alerts and user messages will appear here.</p></div></div> : null}
          {loading ? <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading notification history...</div> : null}
        </div>
      </ScrollArea>
      <div className="flex items-center justify-between border-t px-5 py-3 text-xs text-muted-foreground">
        <span>Showing {items.length} of {total}</span>
        {hasMore ? <Button variant="outline" size="sm" disabled={loading} onClick={() => void load({ append: true })}>Load older</Button> : null}
      </div>
    </SheetContent>
  </Sheet>
}
