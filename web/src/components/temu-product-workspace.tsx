import { useEffect, useState } from "react"
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, PackagePlus, Save, Store } from "lucide-react"
import { toast } from "sonner"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { api, dateLabel, moneyLabel } from "../lib/client-api"
import type { ChannelConnection, ImportJob, ProductItem, TemuProductListing } from "../App"
import { Field } from "./app-ui"

type TemuAccount = {
  id: string
  label?: string
  mallId?: string
  mallName?: string
  configured?: boolean
  active?: boolean
}

type TemuDraft = {
  merchantSku: string
  price: string
  listPrice: string
  quantity: string
  handlingDays: string
  categoryId: string
  shippingTemplateId: string
}

type TemuIssue = { code?: string; field?: string; message?: string }

type TemuPreview = {
  account?: { id?: string; label?: string; mallId?: string; configured?: boolean }
  listing?: TemuProductListing & { draft?: Record<string, unknown> }
  readiness?: { ready?: boolean; blockers?: TemuIssue[]; warnings?: TemuIssue[]; draft?: Record<string, unknown> }
  requestPreview?: Record<string, unknown>
}

const emptyDraft: TemuDraft = { merchantSku: "", price: "", listPrice: "", quantity: "0", handlingDays: "1", categoryId: "", shippingTemplateId: "" }

function draftFrom(value: Record<string, unknown> | undefined, product: ProductItem): TemuDraft {
  const price = Number(value?.price ?? product.websitePrice ?? product.price ?? product.listPrice ?? 0)
  const listPrice = Number(value?.listPrice ?? product.msrp ?? product.listPrice ?? (price > 0 ? Math.ceil(price * 120) / 100 : 0))
  return {
    merchantSku: String(value?.merchantSku || product.temuSku || product.sku || ""),
    price: price > 0 ? price.toFixed(2) : "",
    listPrice: listPrice > 0 ? listPrice.toFixed(2) : "",
    quantity: String(Math.max(0, Number(value?.quantity ?? product.physicalAvailable ?? product.available ?? product.qty ?? product.stockQty ?? 0) || 0)),
    handlingDays: String(Math.max(0, Math.min(2, Number(value?.handlingDays ?? 1) || 0))),
    categoryId: String(value?.categoryId || ""),
    shippingTemplateId: String(value?.shippingTemplateId || "")
  }
}

export function TemuProductWorkspace({ channel, product }: { channel: ChannelConnection; product: ProductItem }) {
  const [accounts, setAccounts] = useState<TemuAccount[]>([])
  const [accountId, setAccountId] = useState("")
  const [draft, setDraft] = useState<TemuDraft>(emptyDraft)
  const [preview, setPreview] = useState<TemuPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [launching, setLaunching] = useState(false)
  const sku = String(product.sku || product.id || "")
  const launchEnabled = channel.settings?.temuListingLaunchEnabled === true
  const selectedAccount = accounts.find((account) => account.id === accountId)
  const storedListing = product.temuListings?.[accountId] || (product.temuListing?.accountId === accountId ? product.temuListing : undefined)
  const listing = preview?.listing || storedListing

  useEffect(() => {
    let live = true
    setLoading(true)
    api<{ activeAccountId?: string; accounts?: TemuAccount[] }>("/api/temu/accounts")
      .then((result) => {
        if (!live) return
        const rows = result.accounts || []
        const selected = result.activeAccountId || rows[0]?.id || ""
        setAccounts(rows)
        setAccountId(selected)
        if (!selected) setDraft(draftFrom(undefined, product))
      })
      .catch((error) => { if (live) toast.error(error instanceof Error ? error.message : "Unable to load Temu shops.") })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [sku])

  useEffect(() => {
    if (!accountId || !sku) return
    let live = true
    setLoading(true)
    api<TemuPreview>(`/api/temu/products/${encodeURIComponent(sku)}/readiness?accountId=${encodeURIComponent(accountId)}`)
      .then((result) => {
        if (!live) return
        setPreview(result)
        setDraft(draftFrom(result.listing?.draft || result.readiness?.draft, product))
      })
      .catch((error) => { if (live) toast.error(error instanceof Error ? error.message : "Unable to check Temu readiness.") })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [accountId, sku])

  function payload() {
    return {
      sku,
      accountId,
      draft: {
        merchantSku: draft.merchantSku.trim(),
        price: Number(draft.price || 0),
        listPrice: Number(draft.listPrice || 0),
        quantity: Math.max(0, Math.floor(Number(draft.quantity || 0) || 0)),
        handlingDays: Math.max(0, Math.min(2, Math.floor(Number(draft.handlingDays || 0) || 0))),
        categoryId: draft.categoryId.trim(),
        shippingTemplateId: draft.shippingTemplateId.trim()
      }
    }
  }

  async function saveAndReview() {
    setSaving(true)
    try {
      const result = await api<TemuPreview & { message?: string }>("/api/temu/listings/preview", { method: "POST", body: JSON.stringify(payload()) })
      setPreview(result)
      setDraft(draftFrom(result.listing?.draft || result.readiness?.draft, product))
      if (result.readiness?.ready) toast.success(result.message || "Temu draft is ready to launch.")
      else toast.warning(result.message || "Temu draft saved with items to resolve.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save the Temu draft.")
    } finally {
      setSaving(false)
    }
  }

  async function launch() {
    setLaunching(true)
    try {
      const result = await api<{ job?: ImportJob; preview?: TemuPreview; message?: string }>("/api/temu/listings/launch", { method: "POST", body: JSON.stringify(payload()) })
      if (result.preview) setPreview(result.preview)
      toast.success(result.message || "Temu launch queued.")
      if (result.job?.id) window.setTimeout(() => window.location.assign(`/jobs/${encodeURIComponent(result.job!.id)}`), 700)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to launch the product to Temu.")
    } finally {
      setLaunching(false)
    }
  }

  const blockers = preview?.readiness?.blockers || listing?.readiness?.blockers || []
  const warnings = preview?.readiness?.warnings || listing?.readiness?.warnings || []
  const ready = preview?.readiness?.ready === true || listing?.readiness?.ready === true

  return <div className="grid gap-4">
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><CardTitle className="flex items-center gap-2 text-base"><Store className="size-4" />Temu shop listing</CardTitle><CardDescription>Save and launch this SKU independently for one connected Temu shop.</CardDescription></div>
          <div className="flex items-center gap-2"><Badge variant={listing?.goodsId ? "default" : ready ? "secondary" : "outline"}>{listing?.goodsId ? String(listing.status || "Submitted").replaceAll("_", " ") : ready ? "Ready" : "Draft"}</Badge>{listing?.updatedAt && <span className="text-xs text-muted-foreground">{dateLabel(listing.updatedAt)}</span>}</div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(220px,320px)_1fr]">
          <div className="grid gap-3">
            <Field label="Temu shop"><Select value={accountId} onValueChange={setAccountId} disabled={loading || !accounts.length}><SelectTrigger><SelectValue placeholder="Select a Temu shop" /></SelectTrigger><SelectContent>{accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.label || account.mallName || account.mallId || account.id}{account.configured ? "" : " (reconnect)"}</SelectItem>)}</SelectContent></Select></Field>
            <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground"><p className="font-medium text-foreground">{selectedAccount?.label || selectedAccount?.mallName || "No shop selected"}</p><p className="mt-1 break-all">Account ID {selectedAccount?.id || "-"}</p><p className="break-all">Mall ID {selectedAccount?.mallId || "-"}</p></div>
            {product.defaultImage && <a href={product.defaultImage} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-md border bg-muted"><img src={product.defaultImage} alt={product.title || sku} className="aspect-square w-full object-contain" /></a>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Field label="Merchant SKU"><Input value={draft.merchantSku} onChange={(event) => setDraft((current) => ({ ...current, merchantSku: event.target.value }))} /></Field>
            <Field label="Selling price"><Input type="number" min="0" step="0.01" value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} /></Field>
            <Field label="List price"><Input type="number" min="0" step="0.01" value={draft.listPrice} onChange={(event) => setDraft((current) => ({ ...current, listPrice: event.target.value }))} /></Field>
            <Field label="Launch quantity"><Input type="number" min="0" step="1" value={draft.quantity} onChange={(event) => setDraft((current) => ({ ...current, quantity: event.target.value }))} /></Field>
            <Field label="Handling days"><Select value={draft.handlingDays} onValueChange={(value) => setDraft((current) => ({ ...current, handlingDays: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="0">Same day</SelectItem><SelectItem value="1">1 day</SelectItem><SelectItem value="2">2 days</SelectItem></SelectContent></Select></Field>
            <Field label="Temu category ID"><Input value={draft.categoryId} placeholder="Optional V3 recommendation" onChange={(event) => setDraft((current) => ({ ...current, categoryId: event.target.value }))} /></Field>
            <Field label="Shipping template ID"><Input value={draft.shippingTemplateId} placeholder="Optional" onChange={(event) => setDraft((current) => ({ ...current, shippingTemplateId: event.target.value }))} /></Field>
            <div className="rounded-md border p-3 sm:col-span-2 xl:col-span-2"><p className="text-xs font-medium text-muted-foreground">Launch basis</p><div className="mt-2 grid grid-cols-2 gap-2 text-sm"><span>Catalog price</span><span className="text-right font-medium">{moneyLabel(product.websitePrice || product.price || product.listPrice || 0)}</span><span>Physical available</span><span className="text-right font-medium">{Number(product.physicalAvailable ?? product.available ?? product.qty ?? 0).toLocaleString()}</span></div></div>
          </div>
        </div>
        <Separator />
        {loading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Checking this shop...</div> : !accounts.length ? <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>No Temu shop connected</AlertTitle><AlertDescription>Connect a shop under Channel Settings before creating a listing.</AlertDescription></Alert> : <div className="grid gap-2">
          {ready && !blockers.length && <Alert className="border-emerald-500/40 bg-emerald-500/10"><CheckCircle2 className="size-4" /><AlertTitle>Ready for reviewed launch</AlertTitle><AlertDescription>The product will be submitted only to {selectedAccount?.label || selectedAccount?.mallName || "the selected shop"}.</AlertDescription></Alert>}
          {blockers.map((issue, index) => <Alert key={`${issue.code}-${index}`} variant="destructive"><AlertCircle className="size-4" /><AlertTitle>{String(issue.field || "Launch requirement").replaceAll("_", " ")}</AlertTitle><AlertDescription>{issue.message}</AlertDescription></Alert>)}
          {warnings.map((issue, index) => <Alert key={`${issue.code}-${index}`}><AlertCircle className="size-4" /><AlertTitle>{String(issue.field || "Review note").replaceAll("_", " ")}</AlertTitle><AlertDescription>{issue.message}</AlertDescription></Alert>)}
        </div>}
        {listing?.lastError && <Alert variant="destructive"><AlertCircle className="size-4" /><AlertTitle>Verify before retrying</AlertTitle><AlertDescription>{listing.lastError}</AlertDescription></Alert>}
        {listing?.goodsId && <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-sm sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Temu goods ID</p><p className="font-medium">{listing.goodsId}</p></div><div><p className="text-xs text-muted-foreground">Temu SKU ID</p><p className="font-medium">{listing.skuId || "Pending catalog refresh"}</p></div><div><p className="text-xs text-muted-foreground">Merchant SKU</p><p className="font-medium">{listing.merchantSku || draft.merchantSku}</p></div></div>}
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => void saveAndReview()} disabled={saving || launching || !accountId}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}Save and review</Button><Button onClick={() => void launch()} disabled={saving || launching || !accountId || !launchEnabled || Boolean(listing?.goodsId) || !ready}>{launching ? <Loader2 className="size-4 animate-spin" /> : <PackagePlus className="size-4" />}Launch to selected shop</Button></div>
        {!launchEnabled && <p className="text-right text-xs text-amber-600">Enable Launch listings in Temu Channel Settings before publishing.</p>}
      </CardContent>
    </Card>
    <div className="flex justify-end"><Button variant="link" asChild><a href="/channels?channel=Temu&tab=connection">Manage Temu shops <ExternalLink className="size-4" /></a></Button></div>
  </div>
}
