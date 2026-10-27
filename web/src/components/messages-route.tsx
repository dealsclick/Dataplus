import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, CheckCheck, Loader2, MessageSquare, RefreshCw, Search, SendHorizontal } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

type Json = Record<string, any>

async function api(path: string, body?: Json) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)
  return data
}

function decodeContent(value: unknown) {
  if (value && typeof value === "object") return String((value as Json).content || (value as Json).text || "")
  const raw = String(value ?? "").trim()
  if (!raw) return ""
  try {
    const parsed = JSON.parse(raw)
    return String(parsed?.content || parsed?.text || raw)
  } catch {
    return raw
  }
}

function timestamp(value: unknown) {
  const numeric = Number(value)
  const date = Number.isFinite(numeric) && numeric > 0 ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric) : new Date(String(value || ""))
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : ""
}

function conversationName(row: Json) {
  const buyer = (Array.isArray(row.participants) ? row.participants : []).find((participant: Json) => String(participant.role || "").toUpperCase() === "BUYER")
  return String(buyer?.nickname || row.buyer?.nickname || row.buyer?.name || row.buyer_name || row.participant?.name || row.user_name || row.buyer_user_id || "TikTok customer")
}

function conversationLastMessage(row: Json) {
  return decodeContent(row.latest_message?.content || row.last_message?.content || row.lastMessage?.content || row.latest_message || row.last_message || row.lastMessage) || "No message preview"
}

function messageSender(row: Json) {
  const role = String(row.sender_role || row.sender?.role || row.sender_type || "").toUpperCase()
  return role.includes("CUSTOMER_SERVICE") || role.includes("SELLER") || role.includes("AGENT")
}

export function MessagesRoute() {
  const [source, setSource] = useState("tiktok")
  const [filter, setFilter] = useState("all")
  const [query, setQuery] = useState("")
  const [rows, setRows] = useState<Json[]>([])
  const [selectedId, setSelectedId] = useState("")
  const [detail, setDetail] = useState<Json | null>(null)
  const [loading, setLoading] = useState(true)
  const [threadLoading, setThreadLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [reply, setReply] = useState("")

  const loadList = async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const params = new URLSearchParams({ limit: "200" })
      if (query.trim()) params.set("q", query.trim())
      if (filter === "unread") params.set("unread", "true")
      const data = await api(`/api/tiktok/messages?${params}`)
      setRows(Array.isArray(data.conversations) ? data.conversations : [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Messages could not load.")
    } finally {
      setLoading(false)
    }
  }

  const loadThread = async (conversationId: string, refresh = true) => {
    setSelectedId(conversationId)
    setThreadLoading(true)
    try {
      const data = await api(`/api/tiktok/messages/${encodeURIComponent(conversationId)}?refresh=${refresh ? "true" : "false"}`)
      setDetail(data)
      if (Number(data.conversation?.unread_count ?? data.conversation?.unreadCount ?? 0) > 0) {
        await api(`/api/tiktok/messages/${encodeURIComponent(conversationId)}/read`, {})
        setRows(current => current.map(row => String(row.conversationId) === conversationId ? { ...row, unread_count: 0, unreadCount: 0 } : row))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Conversation could not load.")
    } finally {
      setThreadLoading(false)
    }
  }

  useEffect(() => { void loadList() }, [source, filter])

  const messages = useMemo(() => Array.isArray(detail?.messages) ? detail.messages : [], [detail])
  const canSend = detail?.conversation?.can_send_message !== false && detail?.conversation?.canSendMessage !== false

  const send = async () => {
    const content = reply.trim()
    if (!content || !selectedId) return
    setSending(true)
    try {
      await api(`/api/tiktok/messages/${encodeURIComponent(selectedId)}/send`, { content })
      setReply("")
      await loadThread(selectedId, true)
      await loadList(true)
      toast.success("Reply sent.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Reply could not be sent.")
    } finally {
      setSending(false)
    }
  }

  const sync = async () => {
    try {
      const data = await api("/api/tiktok/jobs/messages", {})
      toast.success(data.message || "TikTok message sync queued.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Message sync could not be queued.")
    }
  }

  return <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 lg:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-xl font-semibold">Messages</h1><p className="text-sm text-muted-foreground">Customer service inbox</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={() => void sync()}><RefreshCw className="size-4" /> Sync TikTok</Button><Button variant="outline" size="icon" aria-label="Refresh messages" onClick={() => void loadList()}><RefreshCw className="size-4" /></Button></div>
    </div>

    <div className="grid min-h-[620px] flex-1 overflow-hidden rounded-md border bg-background lg:grid-cols-[22rem_minmax(0,1fr)]">
      <section className={cn("min-h-0 border-r", selectedId && "hidden lg:block")}>
        <div className="grid gap-2 border-b p-3">
          <div className="grid grid-cols-2 gap-2"><Select value={source} onValueChange={setSource}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="tiktok">TikTok Shop</SelectItem></SelectContent></Select><Select value={filter} onValueChange={setFilter}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All messages</SelectItem><SelectItem value="unread">Unread</SelectItem></SelectContent></Select></div>
          <form className="relative" onSubmit={event => { event.preventDefault(); void loadList() }}><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search conversations" /></form>
        </div>
        <ScrollArea className="h-[calc(100%-7.25rem)]">
          {loading ? <div className="grid h-40 place-items-center"><Loader2 className="size-5 animate-spin" /></div> : rows.length ? rows.map(row => {
            const id = String(row.conversationId || row.id || "")
            const unread = Number(row.unread_count ?? row.unreadCount ?? 0)
            return <button key={id} type="button" className={cn("grid w-full gap-1 border-b px-3 py-3 text-left hover:bg-muted/50", selectedId === id && "bg-muted")} onClick={() => void loadThread(id)}>
              <span className="flex min-w-0 items-center justify-between gap-2"><span className="truncate text-sm font-medium">{conversationName(row)}</span>{unread > 0 && <Badge>{unread}</Badge>}</span>
              <span className="truncate text-xs text-muted-foreground">{conversationLastMessage(row)}</span>
              <span className="text-[11px] text-muted-foreground">TikTok Shop {row.latest_message?.create_time || row.update_time || row.updatedAt ? `· ${timestamp(row.latest_message?.create_time || row.update_time || row.updatedAt)}` : ""}</span>
            </button>
          }) : <div className="grid h-48 place-items-center px-6 text-center text-sm text-muted-foreground">No TikTok conversations match this view.</div>}
        </ScrollArea>
      </section>

      <section className={cn("min-h-0", !selectedId && "hidden lg:grid lg:place-items-center")}>
        {!selectedId ? <div className="text-center text-muted-foreground"><MessageSquare className="mx-auto mb-3 size-8" /><p className="text-sm">Select a conversation</p></div> : <div className="flex h-full min-h-0 flex-col">
          <div className="flex items-center gap-3 border-b px-3 py-3"><Button className="lg:hidden" variant="ghost" size="icon" aria-label="Back to conversations" onClick={() => { setSelectedId(""); setDetail(null) }}><ArrowLeft className="size-4" /></Button><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{conversationName(detail?.conversation || {})}</p><p className="truncate text-xs text-muted-foreground">TikTok Shop · {selectedId}</p></div><Badge variant="outline"><CheckCheck className="mr-1 size-3" /> Read</Badge></div>
          <ScrollArea className="min-h-0 flex-1 p-4">
            {threadLoading ? <div className="grid h-48 place-items-center"><Loader2 className="size-5 animate-spin" /></div> : <div className="mx-auto grid max-w-4xl gap-3">{messages.map((row: Json, index: number) => {
              const own = messageSender(row)
              return <div key={String(row.id || row.message_id || index)} className={cn("grid max-w-[85%] gap-1 rounded-md border px-3 py-2 text-sm", own ? "ml-auto bg-primary text-primary-foreground" : "mr-auto bg-muted/50")}><p className="whitespace-pre-wrap break-words">{decodeContent(row.content) || `[${String(row.type || "message").toLowerCase()}]`}</p><span className={cn("text-[10px]", own ? "text-primary-foreground/70" : "text-muted-foreground")}>{timestamp(row.create_time || row.created_at)}</span></div>
            })}{!messages.length && <div className="py-16 text-center text-sm text-muted-foreground">No message history returned.</div>}</div>}
          </ScrollArea>
          <div className="border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"><div className="mx-auto flex max-w-4xl items-end gap-2"><Textarea className="min-h-20 resize-none" maxLength={2000} disabled={!canSend} value={reply} onChange={event => setReply(event.target.value)} placeholder={canSend ? "Reply to customer" : "TikTok has closed replies for this conversation"} /><Button size="icon" aria-label="Send reply" disabled={sending || !reply.trim() || !canSend} onClick={() => void send()}>{sending ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}</Button></div></div>
        </div>}
      </section>
    </div>
  </div>
}
