import { useMemo, useRef, useState } from "react"
import { FileText, Loader2, Reply, Send, X } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { api, dateLabel, numberLabel } from "@/lib/client-api"
import { cn } from "@/lib/utils"

type MentionableUser = { id: string; username: string; name: string; department?: string }
type OrderNote = Record<string, unknown>
type NoteResult = { note?: OrderNote; mentions?: OrderNote[]; mentionWarning?: string }

function MentionText({ text }: { text: string }) {
  const parts = text.split(/(@[a-z0-9][a-z0-9._-]{0,63})/gi)
  return <>{parts.map((part, index) => /^@[a-z0-9][a-z0-9._-]{0,63}$/i.test(part)
    ? <strong key={`${part}-${index}`} className="font-semibold text-primary">{part}</strong>
    : part)}</>
}

function MentionTextarea({ value, onChange, users, loadingUsers, loadUsers, placeholder, compact = false }: {
  value: string
  onChange: (value: string) => void
  users: MentionableUser[]
  loadingUsers: boolean
  loadUsers: () => Promise<void>
  placeholder: string
  compact?: boolean
}) {
  const [caret, setCaret] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const mentionToken = value.slice(0, caret).match(/(^|\s)@([a-z0-9._-]*)$/i)
  const query = String(mentionToken?.[2] || "").toLowerCase()
  const suggestions = mentionToken
    ? users.filter((user) => `${user.username} ${user.name}`.toLowerCase().includes(query)).slice(0, 8)
    : []

  const insertMention = (user: MentionableUser) => {
    if (!mentionToken) return
    const tokenStart = caret - mentionToken[0].length + mentionToken[1].length
    const next = `${value.slice(0, tokenStart)}@${user.username} ${value.slice(caret)}`
    const nextCaret = tokenStart + user.username.length + 2
    onChange(next)
    setCaret(nextCaret)
    setSelectedIndex(0)
    window.requestAnimationFrame(() => { ref.current?.focus(); ref.current?.setSelectionRange(nextCaret, nextCaret) })
  }

  return <div className="relative">
    <Textarea
      ref={ref}
      className={compact ? "min-h-20 resize-y" : "min-h-28"}
      value={value}
      onFocus={() => void loadUsers()}
      onClick={(event) => setCaret(event.currentTarget.selectionStart)}
      onKeyUp={(event) => setCaret(event.currentTarget.selectionStart)}
      onChange={(event) => { onChange(event.target.value); setCaret(event.target.selectionStart); setSelectedIndex(0) }}
      onKeyDown={(event) => {
        if (!suggestions.length) return
        if (event.key === "ArrowDown") { event.preventDefault(); setSelectedIndex((current) => (current + 1) % suggestions.length) }
        else if (event.key === "ArrowUp") { event.preventDefault(); setSelectedIndex((current) => (current - 1 + suggestions.length) % suggestions.length) }
        else if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); insertMention(suggestions[selectedIndex] || suggestions[0]) }
        else if (event.key === "Escape") setCaret(-1)
      }}
      placeholder={placeholder}
    />
    {mentionToken && (suggestions.length || loadingUsers) ? <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
      {loadingUsers ? <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading teammates...</div> : suggestions.map((user, index) => <button key={user.id} type="button" className={cn("flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm", index === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/60")} onMouseDown={(event) => { event.preventDefault(); insertMention(user) }}>
        <span className="min-w-0"><span className="block truncate font-medium">{user.name}</span><span className="block truncate text-xs text-muted-foreground">@{user.username}</span></span>
        {user.department ? <span className="shrink-0 text-xs text-muted-foreground">{user.department}</span> : null}
      </button>)}
    </div> : null}
  </div>
}

export function OrderNotesPanel({ orderId, order, documents, onUpdated }: {
  orderId: string
  order: Record<string, unknown>
  documents: OrderNote[]
  onUpdated: () => Promise<void>
}) {
  const [text, setText] = useState("")
  const [saving, setSaving] = useState(false)
  const [attachment, setAttachment] = useState<File | null>(null)
  const [mentionUsers, setMentionUsers] = useState<MentionableUser[]>([])
  const [mentionLoading, setMentionLoading] = useState(false)
  const [replyingTo, setReplyingTo] = useState("")
  const [replyText, setReplyText] = useState("")
  const [replySaving, setReplySaving] = useState(false)
  const notes = Array.isArray(order.orderNotes) ? order.orderNotes as OrderNote[] : []

  const loadMentionUsers = async () => {
    if (mentionUsers.length || mentionLoading) return
    setMentionLoading(true)
    try {
      const result = await api<{ users: MentionableUser[] }>("/api/mentions/users")
      setMentionUsers(result.users || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load teammates for mentions.")
    } finally { setMentionLoading(false) }
  }

  const threads = useMemo(() => {
    const byId = new Map(notes.map((note) => [String(note.id || ""), note]))
    const roots = notes.filter((note) => !String(note.parentNoteId || "") || !byId.has(String(note.parentNoteId || "")))
    return roots.map((root) => {
      const rootId = String(root.id || "")
      const replies = notes.filter((note) => note !== root && String(note.threadId || "") === rootId)
        .sort((left, right) => Date.parse(String(left.createdAt || "")) - Date.parse(String(right.createdAt || "")))
      return { root, replies }
    }).sort((left, right) => Date.parse(String(right.root.createdAt || "")) - Date.parse(String(left.root.createdAt || "")))
  }, [notes])

  const replyTarget = notes.find((note) => String(note.id || "") === replyingTo)
  const fileToBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ""))
    reader.onerror = () => reject(new Error("The selected file could not be read."))
    reader.readAsDataURL(file)
  })
  const notifyMentionChange = (result: NoteResult | null) => {
    if (!result?.mentions?.length) return
    window.dispatchEvent(new CustomEvent("dataplus:mentions-changed"))
    window.dispatchEvent(new CustomEvent("dataplus:notifications-changed"))
  }
  const showSaveResult = (result: NoteResult | null, fallback: string) => {
    if (result?.mentionWarning) toast.warning(result.mentionWarning)
    else if (result?.mentions?.length) toast.success(`Message saved and ${result.mentions.length} teammate${result.mentions.length === 1 ? " was" : "s were"} notified.`)
    else toast.success(fallback)
  }

  const save = async () => {
    if (!text.trim() && !attachment) return toast.error("Enter a note or attach a document before saving.")
    if (attachment && attachment.size > 15 * 1024 * 1024) return toast.error("Attachments must be 15 MB or smaller.")
    setSaving(true)
    try {
      const result = text.trim() ? await api<NoteResult>(`/api/orders/${encodeURIComponent(orderId)}/notes`, { method: "POST", body: JSON.stringify({ text: text.trim() }) }) : null
      if (attachment) await api(`/api/orders/${encodeURIComponent(orderId)}/attachments`, { method: "POST", body: JSON.stringify({ name: attachment.name, mimeType: attachment.type, contentBase64: await fileToBase64(attachment), type: "customer-message", note: text.trim(), noteId: String(result?.note?.id || "") }) })
      setText("")
      setAttachment(null)
      await onUpdated()
      notifyMentionChange(result)
      showSaveResult(result, attachment ? "Note and attachment added to this order." : "Internal order note added.")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save the order note.") }
    finally { setSaving(false) }
  }

  const saveReply = async () => {
    if (!replyingTo || !replyText.trim()) return
    setReplySaving(true)
    try {
      const result = await api<NoteResult>(`/api/orders/${encodeURIComponent(orderId)}/notes`, { method: "POST", body: JSON.stringify({ text: replyText.trim(), parentNoteId: replyingTo }) })
      setReplyText("")
      setReplyingTo("")
      await onUpdated()
      notifyMentionChange(result)
      showSaveResult(result, "Reply added to this conversation.")
    } catch (error) { toast.error(error instanceof Error ? error.message : "Unable to save this reply.") }
    finally { setReplySaving(false) }
  }

  const attachmentsForNote = (note: OrderNote) => documents.filter((document) => String(document.noteId || "") === String(note.id || "") || (!document.noteId && String(document.note || "").trim() === String(note.text || "").trim()))
  const beginReply = (note: OrderNote) => { setReplyingTo(String(note.id || "")); setReplyText("") }
  const renderAttachments = (note: OrderNote) => {
    const noteAttachments = attachmentsForNote(note)
    return noteAttachments.length ? <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">{noteAttachments.map((document) => <a key={String(document.id)} href={String(document.url || "#")} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1 text-xs font-medium hover:bg-muted"><FileText className="size-3.5 shrink-0" /><span className="truncate">{String(document.name || "Attachment")}</span></a>)}</div> : null
  }
  const replyComposer = replyTarget ? <div className="border-t bg-muted/20 p-3 sm:pl-12">
    <div className="mb-2 flex items-center justify-between gap-3"><p className="text-xs font-medium text-muted-foreground">Replying to {String(replyTarget.createdBy || "DataPlus user")}</p><Button variant="ghost" size="icon-sm" onClick={() => { setReplyingTo(""); setReplyText("") }} title="Cancel reply"><X className="size-4" /></Button></div>
    <MentionTextarea value={replyText} onChange={setReplyText} users={mentionUsers} loadingUsers={mentionLoading} loadUsers={loadMentionUsers} compact placeholder="Write a reply or type @username..." />
    <div className="mt-2 flex justify-end"><Button size="sm" disabled={replySaving || !replyText.trim()} onClick={() => void saveReply()}>{replySaving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} Reply</Button></div>
  </div> : null

  return <div className="grid gap-4">
    <Card>
      <CardHeader><CardTitle className="text-sm">Start a conversation</CardTitle><CardDescription>Use @username to assign a follow-up. Replies stay grouped with the message they belong to.</CardDescription></CardHeader>
      <CardContent className="grid gap-3">
        <MentionTextarea value={text} onChange={setText} users={mentionUsers} loadingUsers={mentionLoading} loadUsers={loadMentionUsers} placeholder="Add context or type @username to assign a follow-up..." />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/25 p-3"><div className="min-w-0"><p className="text-sm font-medium">Attach document</p><p className="text-xs text-muted-foreground">PDF, CSV, text, or photo up to 15 MB.</p></div><Input className="max-w-full sm:max-w-xs" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,text/plain,text/csv" capture="environment" onChange={(event) => setAttachment(event.target.files?.[0] || null)} />{attachment ? <p className="w-full text-xs text-muted-foreground">Ready to attach: {attachment.name}</p> : null}</div>
        <div className="flex justify-end"><Button size="sm" disabled={saving || (!text.trim() && !attachment)} onClick={() => void save()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />} {attachment ? "Save note & attachment" : "Post note"}</Button></div>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="text-sm">Internal conversations</CardTitle><CardDescription>{threads.length ? `${numberLabel(threads.length)} conversation${threads.length === 1 ? "" : "s"} · ${numberLabel(notes.length)} total message${notes.length === 1 ? "" : "s"}` : "No internal conversations yet."}</CardDescription></div>{threads.length ? <Badge variant="outline">Newest first</Badge> : null}</div></CardHeader>
      <CardContent className="grid gap-4">
        {threads.map(({ root, replies }) => <section key={String(root.id)} className="overflow-hidden rounded-md border bg-background">
          <div className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold">{String(root.createdBy || "DataPlus user")}</p><p className="text-xs text-muted-foreground">{dateLabel(String(root.createdAt || ""))}</p></div><div className="flex items-center gap-2">{replies.length ? <Badge variant="secondary">{replies.length} {replies.length === 1 ? "reply" : "replies"}</Badge> : null}<Button variant="ghost" size="sm" onClick={() => beginReply(root)}><Reply className="size-4" /> Reply</Button></div></div>
            <p className="mt-3 whitespace-pre-wrap text-sm text-foreground/90"><MentionText text={String(root.text || "")} /></p>
            {renderAttachments(root)}
          </div>
          {replies.length ? <div className="border-t bg-muted/10 px-4 py-1 sm:pl-10">{replies.map((reply) => <article key={String(reply.id)} className="border-l-2 border-primary/20 py-3 pl-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex min-w-0 flex-wrap items-center gap-2"><span className="text-sm font-semibold">{String(reply.createdBy || "DataPlus user")}</span><span className="text-xs text-muted-foreground">replied to {String(reply.replyToName || root.createdBy || "DataPlus user")}</span></div><span className="shrink-0 text-xs text-muted-foreground">{dateLabel(String(reply.createdAt || ""))}</span></div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-foreground/90"><MentionText text={String(reply.text || "")} /></p>
            {renderAttachments(reply)}
            <Button variant="ghost" size="sm" className="mt-2" onClick={() => beginReply(reply)}><Reply className="size-4" /> Reply</Button>
          </article>)}</div> : null}
          {replyTarget && String(replyTarget.threadId || replyTarget.id || "") === String(root.id || "") ? replyComposer : null}
        </section>)}
        {!threads.length ? <p className="py-8 text-center text-sm text-muted-foreground">Start the first internal conversation above.</p> : null}
      </CardContent>
    </Card>
  </div>
}
