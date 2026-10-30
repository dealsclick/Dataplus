import { Alert,AlertDescription,AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card,CardContent } from "@/components/ui/card"
import { Drawer,DrawerContent,DrawerDescription,DrawerHeader,DrawerTitle } from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Sheet,SheetContent } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import type { UIMessage } from "ai"
import {
  AlertCircle,
  Ban,
  FileUp,
  Loader2,
  MessageSquare,
  PanelRightOpen,
  Play,
  SendHorizontal,
  Settings
} from "lucide-react"
import { lazy,Suspense,useEffect,useRef,useState } from "react"
import { toast } from "sonner"
import type {
  ImportJob,
  SystemSettings
} from "../App"
import {
  jobReference
} from "../App"
import { api,dateLabel,moneyLabel,numberLabel } from "../lib/client-api"
import { Field,PageHeader } from "./app-ui"
import type { DavidChatClient } from "./david-ai-client"

const DavidAiClient = lazy(() => import("./david-ai-client").then((module) => ({ default: module.DavidAiClient })))

/*
function LegacyDavidChatPage({ settings, onOpenSettings }: { settings: SystemSettings; onOpenSettings: () => void }) {
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([
    { role: "assistant", content: "Hi, I’m David. I can help you understand DataPlus workflows, troubleshoot a process, or prepare an operational next step. I won’t make changes unless you use the relevant system controls." },
  ])
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const provider = String(settings.aiProvider || "openai") === "google-ai-studio" ? "Google AI Studio" : "OpenAI"
  const ready = Boolean(settings.aiEnabled)

  async function send() {
    const message = draft.trim()
    if (!message || sending || !ready) return
    const nextMessages = [...messages, { role: "user" as const, content: message }]
    setMessages(nextMessages)
    setDraft("")
    setSending(true)
    try {
      const result = await api<{ reply: string }>('/api/ai/chat', { method: "POST", body: JSON.stringify({ messages: nextMessages }) })
      setMessages((current) => [...current, { role: "assistant", content: result.reply }])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "David is unavailable right now.")
      setMessages((current) => [...current, { role: "assistant", content: "I couldn’t answer that just now. Check the AI integration connection and try again." }])
    } finally { setSending(false) }
  }

  return <div className="mx-auto grid w-full max-w-5xl gap-5">
    <PageHeader
      eyebrow="AI assistant"
      title="David"
      description="An operational assistant for understanding DataPlus and preparing approved actions. Chat history stays in this browser session."
      action={<div className="flex items-center gap-2"><Badge variant={ready ? "default" : "secondary"}>{ready ? `${provider} connected` : "AI setup required"}</Badge><Button variant="outline" size="sm" onClick={onOpenSettings}><Settings className="size-4" /> AI settings</Button></div>}
    />
    {!ready ? <Alert><AlertCircle className="size-4" /><AlertTitle>David is not enabled</AlertTitle><AlertDescription>Verify a provider and enable AI integration in System Settings before starting a chat.</AlertDescription></Alert> : null}
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-muted/20">
        <CardTitle className="flex items-center gap-2 text-base"><MessageSquare className="size-4" /> David</CardTitle>
        <CardDescription>{provider} · {String(settings.aiModel || "Default model")} · Read-only guidance</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 p-4">
        <div className="grid min-h-[440px] content-start gap-3 overflow-y-auto rounded-md border bg-muted/10 p-4">
          {messages.map((message, index) => <div key={`${message.role}-${index}`} className={message.role === "user" ? "ml-auto max-w-[85%] rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground" : "mr-auto max-w-[85%] whitespace-pre-wrap rounded-md border bg-background px-3 py-2 text-sm"}>
            <p className="mb-1 text-xs font-semibold opacity-70">{message.role === "user" ? "You" : "David"}</p><DavidMessageContent content={message.content} />
          </div>)}
          {sending && <div className="mr-auto flex items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> David is thinking</div>}
        </div>
        <div className="flex items-end gap-2">
          <Textarea disabled={!ready || sending} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send() } }} rows={3} placeholder={ready ? "Ask David about an inventory, catalog, order, purchasing, warehouse, or channel workflow" : "Enable AI integration to chat with David"} />
          <Button className="shrink-0" disabled={!ready || sending || !draft.trim()} onClick={() => void send()}><SendHorizontal className="size-4" /> Send</Button>
        </div>
        <div className="flex justify-end"><Button size="sm" variant="ghost" onClick={() => setMessages([{ role: "assistant", content: "New conversation started. What would you like to work through?" }])}>Clear conversation</Button></div>
      </CardContent>
    </Card>
  </div>
}

*/

function davidStarterMessages(): UIMessage[] {
  return [davidUiMessage("assistant", "Hi, I'm David. I can help you understand DataPlus workflows, troubleshoot a process, or prepare an operational next step. I won't make changes unless you use the relevant system controls.")]
}

function davidUiMessage(role: "user" | "assistant", text: string): UIMessage {
  return {
    id: globalThis.crypto?.randomUUID?.() || `david-${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    role,
    parts: [{ type: "text", text }],
  }
}

function davidMessageText(message: UIMessage) {
  return message.parts.filter((part) => part.type === "text").map((part) => part.text).join("").trim()
}

type DavidActionProposal = {
  id?: string
  type?: string
  state?: "disabled" | "needs_input" | "already_linked" | "ready_for_approval" | string
  sku?: string
  productName?: string
  productType?: string
  available?: number
  price?: number
  missing?: string[]
  message?: string
  productUrl?: string
  expiresAt?: string
  skus?: string[]
  items?: Array<{ sku?: string; sellerSku?: string; title?: string; state?: string; message?: string }>
  eligibleItems?: Array<{ sku?: string; sellerSku?: string; title?: string; state?: string; message?: string }>
  itemCount?: number
  eligibleCount?: number
  source?: "chat" | "file" | string
}

function davidShopifyLaunchSku(message: string) {
  const normalized = message.trim()
  const match = normalized.match(/\b(?:launch|publish|push|create)\s+(?:sku\s*)?([A-Za-z0-9][A-Za-z0-9._-]{1,})\s+(?:on|to|in)\s+shopify\b/i)
    || normalized.match(/^\s*(?:launch|publish|push|create)\s+sku\s+([A-Za-z0-9][A-Za-z0-9._-]{1,})\s*$/i)
  return match?.[1]?.trim().toUpperCase() || ""
}

function davidWalmartRetirementSkus(message: string) {
  if (!/\bretir(?:e|ing|ement)\b/i.test(message) || !/\bwalmart\b/i.test(message)) return []
  const ignored = new Set(["RETIRE", "RETIRING", "RETIREMENT", "WALMART", "ITEM", "ITEMS", "SKU", "SKUS", "ON", "FROM", "THESE", "THIS", "PLEASE", "DAVID"])
  return [...new Set((message.match(/\b[A-Za-z0-9][A-Za-z0-9._-]{2,}\b/g) || [])
    .map((value) => value.toUpperCase())
    .filter((value) => /\d/.test(value) && !ignored.has(value)))]
}

function walmartRetirementFileSkus(text: string) {
  const rows = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim())
  if (!rows.length) return []
  const delimiter = rows[0].includes("\t") ? "\t" : rows[0].includes(",") ? "," : ""
  const cells = (line: string) => {
    if (!delimiter) return [line.trim()]
    const values: string[] = []
    let value = "", quoted = false
    for (let index = 0; index < line.length; index++) {
      const character = line[index]
      if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index++; continue }
      if (character === '"') { quoted = !quoted; continue }
      if (character === delimiter && !quoted) { values.push(value.trim()); value = ""; continue }
      value += character
    }
    values.push(value.trim())
    return values
  }
  const first = cells(rows[0])
  const headerIndex = first.findIndex((value) => ["sku", "sellersku", "itemsku", "selleritemsku"].includes(value.toLowerCase().replace(/[^a-z]/g, "")))
  const start = headerIndex >= 0 ? 1 : 0
  const column = headerIndex >= 0 ? headerIndex : 0
  return [...new Set(rows.slice(start).map((line) => cells(line)[column]?.trim().toUpperCase() || "").filter((sku) => /^[A-Z0-9][A-Z0-9._-]{1,199}$/.test(sku)))]
}

function DavidMessageContent({ content }: { content: string }) {
  const inline = (value: string) => value.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) => part.startsWith("**") && part.endsWith("**")
    ? <strong key={index}>{part.slice(2, -2)}</strong>
    : <span key={index}>{part}</span>)
  return <div className="grid gap-1.5">{content.split("\n").map((line, index) => {
    const numbered = line.match(/^\s*(\d+)\.\s+(.+)$/)
    const bullet = line.match(/^\s*[-*]\s+(.+)$/)
    if (numbered) return <div key={index} className="flex gap-2"><span className="shrink-0 text-muted-foreground">{numbered[1]}.</span><span>{inline(numbered[2])}</span></div>
    if (bullet) return <div key={index} className="flex gap-2"><span className="shrink-0 text-muted-foreground">-</span><span>{inline(bullet[1])}</span></div>
    return line ? <p key={index}>{inline(line)}</p> : <div key={index} className="h-1" />
  })}</div>
}

function appendDavidExchange(messages: UIMessage[], userText: string, assistantText: string) {
  return [...messages, davidUiMessage("user", userText), davidUiMessage("assistant", assistantText)]
}

function DavidConversation({
  settings,
  compact = false,
  onOpenSettings,
  onOpenFull,
}: {
  settings: SystemSettings
  compact?: boolean
  onOpenSettings: () => void
  onOpenFull?: () => void
}) {
  return <Suspense fallback={<div className={compact ? "flex min-h-0 flex-1 items-center justify-center" : "flex min-h-[560px] items-center justify-center"}><Loader2 className="size-5 animate-spin text-muted-foreground" /><span className="ml-2 text-sm text-muted-foreground">Opening David</span></div>}>
    <DavidAiClient id={compact ? "david-drawer" : "david-workspace"} initialMessages={davidStarterMessages()}>
      {(client) => <DavidConversationContent settings={settings} compact={compact} onOpenSettings={onOpenSettings} onOpenFull={onOpenFull} client={client} />}
    </DavidAiClient>
  </Suspense>
}

function DavidConversationContent({
  settings,
  compact = false,
  onOpenSettings,
  onOpenFull,
  client,
}: {
  settings: SystemSettings
  compact?: boolean
  onOpenSettings: () => void
  onOpenFull?: () => void
  client: DavidChatClient
}) {
  const [draft, setDraft] = useState("")
  const [actionBusy, setActionBusy] = useState(false)
  const [proposal, setProposal] = useState<DavidActionProposal | null>(null)
  const [retirementReason, setRetirementReason] = useState("")
  const [retirementConfirmation, setRetirementConfirmation] = useState("")
  const retirementFileInput = useRef<HTMLInputElement | null>(null)
  const scrollTarget = useRef<HTMLDivElement | null>(null)
  const { messages, sendMessage, setMessages, status, error, clearError } = client
  const provider = String(settings.aiProvider || "openai") === "google-ai-studio" ? "Google AI Studio" : "OpenAI"
  const ready = Boolean(settings.aiEnabled)
  const sending = status === "submitted" || status === "streaming" || actionBusy
  const actionScopes = settings.aiToolScopes as Record<string, unknown> | undefined
  const shopifyActionsEnabled = Boolean(settings.aiOperationalActionsEnabled && actionScopes?.["shopify.launch"])
  const walmartRetirementEnabled = Boolean(settings.aiOperationalActionsEnabled && actionScopes?.["walmart.retire"])

  useEffect(() => { scrollTarget.current?.scrollIntoView({ block: "end", behavior: "smooth" }) }, [messages, status])
  useEffect(() => {
    if (error) toast.error(error.message || "David is unavailable right now.")
  }, [error])

  async function prepareWalmartRetirement(skus: string[], userMessage: string, source: "chat" | "file") {
    setActionBusy(true)
    try {
      const result = await api<{ proposal?: DavidActionProposal }>("/api/ai/actions/walmart-retire/preflight", {
        method: "POST",
        body: JSON.stringify({ skus, source }),
      })
      const nextProposal = result.proposal || { type: "walmart_retire", state: "needs_input", skus, message: "David could not prepare that Walmart retirement review." }
      setProposal(nextProposal)
      setRetirementReason("")
      setRetirementConfirmation("")
      setMessages((current) => appendDavidExchange(current, userMessage, String(nextProposal.message || "Walmart retirement review completed.")))
    } catch (requestError) {
      const reply = requestError instanceof Error ? requestError.message : "David could not review that Walmart retirement request."
      setMessages((current) => appendDavidExchange(current, userMessage, reply))
      toast.error(reply)
    } finally {
      setActionBusy(false)
    }
  }

  async function chooseWalmartRetirementFile(file?: File | null) {
    if (!file || sending || !ready) return
    if (file.size > 5 * 1024 * 1024) { toast.error("Choose a CSV or text file smaller than 5 MB."); return }
    try {
      const skus = walmartRetirementFileSkus(await file.text())
      if (!skus.length) { toast.error("No valid SKUs were found. Use a SKU column or one SKU per line."); return }
      await prepareWalmartRetirement(skus, `Review ${skus.length.toLocaleString()} Walmart SKUs from ${file.name} for bulk retirement.`, "file")
    } catch (fileError) {
      toast.error(fileError instanceof Error ? fileError.message : "Unable to read the retirement file.")
    } finally {
      if (retirementFileInput.current) retirementFileInput.current.value = ""
    }
  }

  async function send() {
    const message = draft.trim()
    if (!message || sending || !ready) return
    setDraft("")
    clearError()
    const launchSku = davidShopifyLaunchSku(message)
    const retirementRequested = /\bretir(?:e|ing|ement)\b/i.test(message) && /\bwalmart\b/i.test(message)
    const pathSku = window.location.pathname.match(/^\/products\/([^/]+)$/)?.[1]
    const retirementSkus = davidWalmartRetirementSkus(message)
    if (retirementRequested && !retirementSkus.length && pathSku) retirementSkus.push(decodeURIComponent(pathSku).toUpperCase())
    if (retirementRequested) {
      await prepareWalmartRetirement(retirementSkus, message, "chat")
      return
    }
    if (launchSku) {
      setActionBusy(true)
      try {
        const result = await api<{ proposal?: DavidActionProposal }>("/api/ai/actions/shopify-launch/preflight", {
          method: "POST",
          body: JSON.stringify({ sku: launchSku }),
        })
        const nextProposal = result.proposal || { state: "needs_input", sku: launchSku, message: "David could not prepare that launch review." }
        setProposal(nextProposal)
        setMessages((current) => appendDavidExchange(current, message, String(nextProposal.message || "Shopify launch review completed.")))
      } catch (requestError) {
        const reply = requestError instanceof Error ? requestError.message : "David could not review that Shopify launch request."
        setMessages((current) => appendDavidExchange(current, message, reply))
        toast.error(reply)
      } finally {
        setActionBusy(false)
      }
      return
    }
    try {
      await sendMessage({ text: message })
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "David is unavailable right now.")
    }
  }

  async function approveShopifyLaunch() {
    if (!proposal?.id || proposal.state !== "ready_for_approval" || actionBusy) return
    setActionBusy(true)
    try {
      const result = await api<{ message?: string; job?: ImportJob }>("/api/ai/actions/shopify-launch/execute", {
        method: "POST",
        body: JSON.stringify({ proposalId: proposal.id }),
      })
      const reply = result.message || `${proposal.sku || "SKU"} is queued for Shopify launch.`
      setMessages((current) => appendDavidExchange(current, `Approve Shopify launch for ${proposal.sku}.`, reply))
      setProposal(null)
      toast.success(result.job?.id ? `Shopify launch ${jobReference(result.job)} queued.` : reply)
    } catch (requestError) {
      const reply = requestError instanceof Error ? requestError.message : "Unable to queue the Shopify launch."
      setMessages((current) => appendDavidExchange(current, `Approve Shopify launch for ${proposal.sku}.`, reply))
      toast.error(reply)
    } finally {
      setActionBusy(false)
    }
  }

  async function approveWalmartRetirement() {
    if (!proposal?.id || proposal.type !== "walmart_retire" || proposal.state !== "ready_for_approval" || actionBusy) return
    setActionBusy(true)
    try {
      const result = await api<{ message?: string; job?: ImportJob }>("/api/ai/actions/walmart-retire/execute", {
        method: "POST",
        body: JSON.stringify({ proposalId: proposal.id, reason: retirementReason, confirmation: retirementConfirmation }),
      })
      const reply = result.message || "Walmart item retirement queued."
      setMessages((current) => appendDavidExchange(current, `Approve permanent Walmart retirement for ${proposal.eligibleCount ?? proposal.eligibleItems?.length ?? 0} item(s).`, reply))
      setProposal(null)
      setRetirementReason("")
      setRetirementConfirmation("")
      toast.success(result.job?.id ? `Walmart retirement ${jobReference(result.job)} queued.` : reply)
    } catch (requestError) {
      const reply = requestError instanceof Error ? requestError.message : "Unable to queue Walmart retirement."
      setMessages((current) => appendDavidExchange(current, "Approve Walmart retirement.", reply))
      toast.error(reply)
    } finally {
      setActionBusy(false)
    }
  }

  return <div className={compact ? "flex min-h-0 flex-1 flex-col" : "flex min-h-[560px] flex-col"}>
    <div className="flex items-start justify-between gap-3 border-b px-4 py-3 pr-12">
      <div>
        <div className="flex items-center gap-2"><MessageSquare className="size-4 text-primary" /><h2 className="font-semibold">David</h2><Badge variant={ready ? "secondary" : "outline"}>{ready ? provider : "Setup required"}</Badge></div>
        <p className="mt-1 text-xs text-muted-foreground">{String(settings.aiModel || "Default model")} - guided actions require your approval</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onOpenFull ? <Button variant="ghost" size="icon" title="Open full workspace" onClick={onOpenFull}><PanelRightOpen className="size-4" /></Button> : null}
        <Button variant="ghost" size="sm" onClick={() => { setMessages(davidStarterMessages()); setProposal(null); setRetirementReason(""); setRetirementConfirmation("") }}>New chat</Button>
      </div>
    </div>
    {!ready ? <Alert className="m-4"><AlertCircle className="size-4" /><AlertTitle>David is not enabled</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-2">Verify the AI integration before starting a chat.<Button size="sm" variant="outline" onClick={onOpenSettings}>AI settings</Button></AlertDescription></Alert> : null}
    <div className={compact ? "min-h-0 flex-1 overflow-y-auto p-4" : "flex-1 overflow-y-auto p-4"}>
      <div className="grid content-start gap-3">
        {messages.map((message) => {
          const content = davidMessageText(message)
          if (!content) return null
          return <div key={message.id} className={message.role === "user" ? "ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground" : "ai-result-surface mr-auto max-w-[88%] whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm shadow-sm"}>
            <p className="mb-1 text-xs font-semibold opacity-70">{message.role === "user" ? "You" : "David"}</p><DavidMessageContent content={content} />
          </div>
        })}
        {proposal?.type === "walmart_retire" ? <Card className="ai-result-surface mr-auto w-full max-w-[92%] shadow-none">
          <CardContent className="grid gap-3 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">Walmart retirement review</p><p className="text-xs text-muted-foreground">{proposal.source === "file" ? "Uploaded bulk retirement" : "Permanent marketplace action"}</p></div><Badge variant={proposal.state === "ready_for_approval" ? "destructive" : "outline"}>{proposal.state === "ready_for_approval" ? `${proposal.eligibleCount ?? proposal.eligibleItems?.length ?? 0} ready` : proposal.state === "disabled" ? "Actions disabled" : "Needs review"}</Badge></div>
            <div className="max-h-48 overflow-y-auto rounded-md border bg-background"><div className="divide-y">{proposal.items?.map((item) => <div key={String(item.sku)} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 px-3 py-2 text-xs"><div className="min-w-0"><p className="truncate font-medium">{item.sku}</p>{item.sellerSku && item.sellerSku !== item.sku ? <p className="truncate text-muted-foreground">Seller SKU: {item.sellerSku}</p> : null}</div><Badge variant={item.state === "ready" ? "secondary" : item.state === "already_retired" ? "outline" : "destructive"}>{item.message || item.state}</Badge></div>)}</div></div>
            {(proposal.itemCount || 0) > (proposal.items?.length || 0) ? <p className="text-xs text-muted-foreground">Showing the first {proposal.items?.length || 0} of {numberLabel(proposal.itemCount || 0)} reviewed SKUs. The job artifact will contain every result.</p> : null}
            {proposal.state === "ready_for_approval" ? <div className="grid gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3"><Field label="Retirement reason"><Input value={retirementReason} onChange={(event) => setRetirementReason(event.target.value)} maxLength={500} placeholder="For example: discontinued by supplier" /></Field><Field label={`Enter RETIRE ${proposal.eligibleCount ?? proposal.eligibleItems?.length ?? 0} to confirm`}><Input value={retirementConfirmation} onChange={(event) => setRetirementConfirmation(event.target.value)} autoComplete="off" /></Field><p className="text-xs text-muted-foreground">This permanently retires only the ready, linked seller SKUs. Excluded items are not changed.</p></div> : null}
            <div className="flex flex-wrap justify-end gap-2">{proposal.state === "ready_for_approval" ? <Button variant="destructive" size="sm" disabled={!walmartRetirementEnabled || actionBusy || retirementReason.trim().length < 5 || retirementConfirmation.trim().toUpperCase() !== `RETIRE ${proposal.eligibleCount ?? proposal.eligibleItems?.length ?? 0}`} onClick={() => void approveWalmartRetirement()}>{actionBusy ? <Loader2 className="size-4 animate-spin" /> : <Ban className="size-4" />} Schedule bulk retirement</Button> : null}</div>
            {proposal.state === "ready_for_approval" && !walmartRetirementEnabled ? <p className="text-xs text-muted-foreground">Enable David operational actions and Walmart item retirement in System Settings before approval.</p> : null}
          </CardContent>
        </Card> : proposal ? <Card className="ai-result-surface mr-auto max-w-[88%] shadow-none">
          <CardContent className="grid gap-3 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">Shopify launch review</p><p className="text-xs text-muted-foreground">{proposal.sku || "SKU"}{proposal.productName ? ` - ${proposal.productName}` : ""}</p></div><Badge variant={proposal.state === "ready_for_approval" ? "default" : proposal.state === "already_linked" ? "secondary" : "outline"}>{proposal.state === "ready_for_approval" ? "Ready for approval" : proposal.state === "already_linked" ? "Already linked" : proposal.state === "disabled" ? "Actions disabled" : "Needs information"}</Badge></div>
            {proposal.state === "ready_for_approval" ? <div className="grid gap-1 rounded-md border bg-background p-2 text-xs text-muted-foreground"><span>Product type: {proposal.productType || "Not set"}</span><span>Available: {Number(proposal.available || 0).toLocaleString()}</span><span>Price: {moneyLabel(proposal.price || 0)}</span>{proposal.expiresAt ? <span>Approval expires {dateLabel(proposal.expiresAt)}</span> : null}</div> : null}
            {proposal.missing?.length ? <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-950"><p className="font-medium">Complete before launch</p><p className="mt-1">{proposal.missing.join(", ")}</p></div> : null}
            <div className="flex flex-wrap justify-end gap-2">{proposal.productUrl ? <Button asChild variant="outline" size="sm"><a href={proposal.productUrl}>Open product</a></Button> : null}{proposal.state === "ready_for_approval" ? <Button size="sm" disabled={!shopifyActionsEnabled || actionBusy} onClick={() => void approveShopifyLaunch()}>{actionBusy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Queue Shopify launch</Button> : null}</div>
            {proposal.state === "ready_for_approval" && !shopifyActionsEnabled ? <p className="text-xs text-muted-foreground">Enable David operational actions and Shopify SKU launch in System Settings before approval.</p> : null}
          </CardContent>
        </Card> : null}
        {sending ? <div className="mr-auto flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> David is thinking</div> : null}
        <div ref={scrollTarget} />
      </div>
    </div>
    <div className="border-t bg-background p-3">
      <div className="flex items-end gap-2 rounded-lg border bg-muted/20 p-2">
        <input ref={retirementFileInput} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(event) => void chooseWalmartRetirementFile(event.target.files?.[0])} />
        <Button type="button" size="icon" variant="ghost" className="shrink-0" disabled={!ready || sending} onClick={() => retirementFileInput.current?.click()} title="Upload Walmart retirement SKUs"><FileUp className="size-4" /></Button>
        <Textarea className="min-h-11 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0" disabled={!ready || sending} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send() } }} rows={compact ? 2 : 3} placeholder={ready ? "Ask David anything..." : "Enable AI integration to chat with David"} />
        <Button size="icon" className="shrink-0" disabled={!ready || sending || !draft.trim()} onClick={() => void send()} title="Send message"><SendHorizontal className="size-4" /></Button>
      </div>
    </div>
  </div>
}

export function DavidChatDrawer({ open, onOpenChange, settings, onOpenSettings, onOpenFull }: { open: boolean; onOpenChange: (open: boolean) => void; settings: SystemSettings; onOpenSettings: () => void; onOpenFull: () => void }) {
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 639px)").matches)
  useEffect(() => {
    const media = window.matchMedia("(max-width: 639px)")
    const sync = () => setMobile(media.matches)
    sync(); media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [])
  if (mobile) return <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
    <DrawerContent className="h-[88dvh]">
      <DrawerHeader className="sr-only"><DrawerTitle>David</DrawerTitle><DrawerDescription>DataPlus operational assistant</DrawerDescription></DrawerHeader>
      <div className="min-h-0 flex-1"><DavidConversation compact settings={settings} onOpenSettings={onOpenSettings} onOpenFull={onOpenFull} /></div>
    </DrawerContent>
  </Drawer>
  return <Sheet open={open} onOpenChange={onOpenChange}>
    <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-[440px]">
      <DavidConversation compact settings={settings} onOpenSettings={onOpenSettings} onOpenFull={onOpenFull} />
    </SheetContent>
  </Sheet>
}

export function DavidChatPage({ settings, onOpenSettings }: { settings: SystemSettings; onOpenSettings: () => void }) {
  const provider = String(settings.aiProvider || "openai") === "google-ai-studio" ? "Google AI Studio" : "OpenAI"
  const ready = Boolean(settings.aiEnabled)
  return <div className="mx-auto grid w-full max-w-5xl gap-5">
    <PageHeader
      eyebrow="AI assistant"
      title="David"
      description="An operational assistant that uses enabled, page-aware scopes and prepares approved actions. Chat history stays in this browser session."
      action={<div className="flex items-center gap-2"><Badge variant={ready ? "default" : "secondary"}>{ready ? `${provider} connected` : "AI setup required"}</Badge><Button variant="outline" size="sm" onClick={onOpenSettings}><Settings className="size-4" /> AI settings</Button></div>}
    />
    <Card className="overflow-hidden"><DavidConversation settings={settings} onOpenSettings={onOpenSettings} /></Card>
  </div>
}
