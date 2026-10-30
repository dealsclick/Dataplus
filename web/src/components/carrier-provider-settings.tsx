import { useEffect, useState, type ReactNode } from "react"
import { CheckCircle2, ExternalLink, KeyRound, Loader2, LockKeyhole, RefreshCw, Settings2, Truck } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, dateLabel } from "../lib/client-api"

type CarrierCapability = { id: string; label: string; status: string; detail: string }

type CarrierEnvironmentStatus = {
  environment: "production" | "test"
  clientId?: string
  secretConfigured?: boolean
  accountConfigured?: boolean
  accountEnding?: string
  accountType?: string
  cridConfigured?: boolean
  cridEnding?: string
  midConfigured?: boolean
  midEnding?: string
  webhookAdminEmail?: string
  webhookSecretConfigured?: boolean
  configured?: boolean
  updatedAt?: string
  lastTestedAt?: string
  lastTestStatus?: string
  lastTestMessage?: string
  lastVerifiedAt?: string
  lastTokenScopes?: string[]
  lastTokenLifetimeSeconds?: number
  lastTokenStatus?: string
  capabilities?: CarrierCapability[]
}

type CarrierProviderStatus = {
  id: string
  name: string
  available: boolean
  status?: string
  message?: string
  environment?: "production" | "test"
  configured?: boolean
  accountEnding?: string
  lastTestedAt?: string
  lastTestStatus?: string
  lastTestMessage?: string
  lastVerifiedAt?: string
  lastTokenScopes?: string[]
  lastTokenLifetimeSeconds?: number
  lastTokenStatus?: string
  cridConfigured?: boolean
  midConfigured?: boolean
  accountConfigured?: boolean
  accountType?: string
  webhookAdminEmail?: string
  capabilities?: CarrierCapability[]
  environments?: Record<"production" | "test", CarrierEnvironmentStatus>
}

type CarrierProviders = Record<string, CarrierProviderStatus>

const plannedProviderOrder = ["fedex", "dhl", "ontrac", "amazon_shipping"]

function tokenLifetimeLabel(seconds = 0) {
  if (!seconds) return "Not reported"
  const hours = seconds / 3600
  return hours >= 1 ? `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hours` : `${Math.ceil(seconds / 60)} minutes`
}

function CredentialField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="grid gap-1.5 text-sm"><span className="font-medium">{label}</span>{children}{hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}</label>
}

export function CarrierProviderSettings({ canManage }: { canManage: boolean }) {
  const [providers, setProviders] = useState<CarrierProviders>({})
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [uspsDialogOpen, setUspsDialogOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [rowTesting, setRowTesting] = useState(false)
  const [uspsSaving, setUspsSaving] = useState(false)
  const [uspsTesting, setUspsTesting] = useState(false)
  const [uspsRowTesting, setUspsRowTesting] = useState(false)
  const [draft, setDraft] = useState({ environment: "production" as "production" | "test", clientId: "", clientSecret: "", accountNumber: "" })
  const [uspsDraft, setUspsDraft] = useState({ environment: "production" as "production" | "test", clientId: "", clientSecret: "", crid: "", mid: "", accountType: "EPS", accountNumber: "", webhookAdminEmail: "" })

  const load = async () => {
    setLoading(true)
    try {
      const result = await api<{ providers?: CarrierProviders }>("/api/shipping-providers")
      setProviders(result.providers || {})
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to load carrier connections.")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const ups = providers.ups
  const usps = providers.usps
  const environmentStatus = (environment = draft.environment) => ups?.environments?.[environment]
  const selectedStatus = environmentStatus()
  const canSubmit = Boolean(draft.clientId.trim() && (draft.clientSecret.trim() || selectedStatus?.secretConfigured) && (draft.accountNumber.trim() || selectedStatus?.accountConfigured))
  const uspsEnvironmentStatus = (environment = uspsDraft.environment) => usps?.environments?.[environment]
  const selectedUspsStatus = uspsEnvironmentStatus()
  const canSubmitUsps = Boolean(uspsDraft.clientId.trim() && (uspsDraft.clientSecret.trim() || selectedUspsStatus?.secretConfigured))

  const openUpsDialog = (environment = ups?.environment || "production") => {
    const normalized = environment === "test" ? "test" : "production"
    const status = ups?.environments?.[normalized]
    setDraft({ environment: normalized, clientId: String(status?.clientId || ""), clientSecret: "", accountNumber: "" })
    setDialogOpen(true)
  }

  const changeEnvironment = (environment: "production" | "test") => {
    const status = ups?.environments?.[environment]
    setDraft({ environment, clientId: String(status?.clientId || ""), clientSecret: "", accountNumber: "" })
  }

  const saveCredentials = async ({ close = true, notify = true }: { close?: boolean; notify?: boolean } = {}) => {
    setSaving(true)
    try {
      const result = await api<{ provider?: CarrierProviderStatus; message?: string }>("/api/shipping-providers/ups/credentials", {
        method: "PUT",
        body: JSON.stringify(draft),
      })
      if (result.provider) setProviders((current) => ({ ...current, ups: result.provider as CarrierProviderStatus }))
      setDraft((current) => ({ ...current, clientSecret: "", accountNumber: "" }))
      if (close) setDialogOpen(false)
      if (notify) toast.success(result.message || "UPS credentials saved.")
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save UPS credentials.")
      return false
    } finally {
      setSaving(false)
    }
  }

  const verifyAndSave = async () => {
    setTesting(true)
    try {
      const testResult = await api<{ message?: string }>("/api/shipping-providers/ups/test", {
        method: "POST",
        body: JSON.stringify(draft),
      })
      const saved = await saveCredentials({ close: true, notify: false })
      if (saved) toast.success(testResult.message || "UPS connection verified and saved.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "UPS connection test failed.")
      await load()
    } finally {
      setTesting(false)
    }
  }

  const testSavedConnection = async () => {
    setRowTesting(true)
    try {
      const result = await api<{ provider?: CarrierProviderStatus; message?: string }>("/api/shipping-providers/ups/test", {
        method: "POST",
        body: JSON.stringify({ environment: ups?.environment || "production" }),
      })
      if (result.provider) setProviders((current) => ({ ...current, ups: result.provider as CarrierProviderStatus }))
      toast.success(result.message || "UPS connection verified.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "UPS connection test failed.")
      await load()
    } finally {
      setRowTesting(false)
    }
  }

  const openUspsDialog = (environment = usps?.environment || "production") => {
    const normalized = environment === "test" ? "test" : "production"
    const status = usps?.environments?.[normalized]
    setUspsDraft({ environment: normalized, clientId: String(status?.clientId || ""), clientSecret: "", crid: "", mid: "", accountType: String(status?.accountType || "EPS"), accountNumber: "", webhookAdminEmail: String(status?.webhookAdminEmail || "") })
    setUspsDialogOpen(true)
  }

  const changeUspsEnvironment = (environment: "production" | "test") => {
    const status = usps?.environments?.[environment]
    setUspsDraft({ environment, clientId: String(status?.clientId || ""), clientSecret: "", crid: "", mid: "", accountType: String(status?.accountType || "EPS"), accountNumber: "", webhookAdminEmail: String(status?.webhookAdminEmail || "") })
  }

  const saveUspsCredentials = async ({ close = true, notify = true }: { close?: boolean; notify?: boolean } = {}) => {
    setUspsSaving(true)
    try {
      const result = await api<{ provider?: CarrierProviderStatus; message?: string }>("/api/shipping-providers/usps/credentials", { method: "PUT", body: JSON.stringify(uspsDraft) })
      if (result.provider) setProviders((current) => ({ ...current, usps: result.provider as CarrierProviderStatus }))
      setUspsDraft((current) => ({ ...current, clientSecret: "", crid: "", mid: "", accountNumber: "" }))
      if (close) setUspsDialogOpen(false)
      if (notify) toast.success(result.message || "USPS credentials saved.")
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save USPS credentials.")
      return false
    } finally {
      setUspsSaving(false)
    }
  }

  const verifyAndSaveUsps = async () => {
    setUspsTesting(true)
    try {
      const result = await api<{ message?: string }>("/api/shipping-providers/usps/test", { method: "POST", body: JSON.stringify(uspsDraft) })
      const saved = await saveUspsCredentials({ close: true, notify: false })
      if (saved) toast.success(result.message || "USPS connection verified and saved.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "USPS connection test failed.")
      await load()
    } finally {
      setUspsTesting(false)
    }
  }

  const testSavedUspsConnection = async () => {
    setUspsRowTesting(true)
    try {
      const result = await api<{ provider?: CarrierProviderStatus; message?: string }>("/api/shipping-providers/usps/test", { method: "POST", body: JSON.stringify({ environment: usps?.environment || "production" }) })
      if (result.provider) setProviders((current) => ({ ...current, usps: result.provider as CarrierProviderStatus }))
      toast.success(result.message || "USPS connection verified.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "USPS connection test failed.")
      await load()
    } finally {
      setUspsRowTesting(false)
    }
  }

  return <>
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Truck className="size-4" /> Direct carrier accounts</CardTitle>
        <CardDescription>Credentials stay on the server and are never returned to the browser. UPS and USPS direct APIs are available; additional carriers remain reserved for later support.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {loading ? <div className="flex items-center gap-2 border-t p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Loading carrier connections...</div> : <div className="divide-y border-t">
          <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">UPS</p><Badge variant={ups?.configured ? "default" : "outline"}>{ups?.configured ? "Configured" : "Not configured"}</Badge><Badge variant="secondary">{ups?.environment === "test" ? "Test" : "Production"}</Badge>{ups?.lastTestStatus === "verified" ? <Badge variant="outline" className="border-emerald-500/50 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-3" /> Verified</Badge> : null}</div>
              <p className="mt-1 text-sm text-muted-foreground">Direct negotiated rates use the UPS Rating API. UPS tracking numbers use the UPS Tracking API for carrier scans and available delivery evidence. {ups?.accountEnding ? `Billing account ending ${ups.accountEnding}.` : "Add the billing account linked to the UPS app."}</p>
              <p className="mt-1 text-xs text-muted-foreground">{ups?.lastTestedAt ? `Last tested ${dateLabel(ups.lastTestedAt)}${ups.lastTestMessage ? `: ${ups.lastTestMessage}` : ""}` : "Connection has not been tested."}</p>
              {ups?.configured ? <div className="mt-3 grid gap-2 rounded-md border bg-muted/20 p-3 text-sm sm:grid-cols-3">
                <div><p className="text-xs font-medium uppercase text-muted-foreground">OAuth access</p><div className="mt-1 flex items-center gap-1.5 font-medium">{ups.lastTestStatus === "verified" ? <CheckCircle2 className="size-4 text-emerald-600" /> : <KeyRound className="size-4 text-amber-600" />}{ups.lastTestStatus === "verified" ? "Verified" : "Needs verification"}</div></div>
                <div><p className="text-xs font-medium uppercase text-muted-foreground">DataPlus uses</p><p className="mt-1 font-medium">Rating + Tracking APIs</p><p className="text-xs text-muted-foreground">Rates, carrier scans, POD and available delivery media</p></div>
                <div><p className="text-xs font-medium uppercase text-muted-foreground">Token lifetime</p><p className="mt-1 font-medium">{tokenLifetimeLabel(ups.lastTokenLifetimeSeconds)}</p><p className="text-xs text-muted-foreground">Renews automatically</p></div>
                <div className="sm:col-span-3"><p className="text-xs font-medium uppercase text-muted-foreground">Automatic tracking</p><p className="mt-1 font-medium">Daytime batches + nightly 11:00 PM ET sweep</p><p className="text-xs text-muted-foreground">UPS tracking numbers use the direct UPS API. Track Alert webhooks require a separate UPS premium subscription.</p></div>
                <div className="sm:col-span-3"><p className="text-xs font-medium uppercase text-muted-foreground">UPS-reported scopes</p>{ups.lastTokenScopes?.length ? <div className="mt-1 flex flex-wrap gap-1">{ups.lastTokenScopes.map((scope) => <Badge key={scope} variant="outline" className="max-w-full break-all">{scope}</Badge>)}</div> : <p className="mt-1 text-xs text-muted-foreground">UPS did not return named scopes. A valid OAuth token confirms authentication, but UPS does not include the Developer Portal subscription list in this response.</p>}</div>
              </div> : null}
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Button type="button" size="sm" variant="outline" disabled={!canManage || !ups?.configured || rowTesting} onClick={() => void testSavedConnection()}>{rowTesting ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Test</Button>
              <Button type="button" size="sm" disabled={!canManage} onClick={() => openUpsDialog()}><Settings2 className="size-4" /> Configure</Button>
              <Button type="button" size="sm" variant="outline" asChild><a href="https://developer.ups.com/" target="_blank" rel="noreferrer">UPS portal <ExternalLink className="size-4" /></a></Button>
            </div>
          </div>
          <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><p className="font-semibold">USPS</p><Badge variant={usps?.configured ? "default" : "outline"}>{usps?.configured ? "Configured" : "Not configured"}</Badge><Badge variant="secondary">{usps?.environment === "test" ? "Test" : "Production"}</Badge>{usps?.lastTestStatus === "verified" ? <Badge variant="outline" className="border-emerald-500/50 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-3" /> Verified</Badge> : null}</div>
              <p className="mt-1 text-sm text-muted-foreground">Direct USPS uses Addresses 3.0, Domestic Prices 3.0, and modern Tracking 3.2. The Consumer Key and Consumer Secret are enough for default-product APIs; postage labels require separate USPS Ship and payment approval.</p>
              <p className="mt-1 text-xs text-muted-foreground">{usps?.lastTestedAt ? `Last tested ${dateLabel(usps.lastTestedAt)}${usps.lastTestMessage ? `: ${usps.lastTestMessage}` : ""}` : "Connection has not been tested."}</p>
              {usps?.configured ? <div className="mt-3 grid gap-2 rounded-md border bg-muted/20 p-3 text-sm sm:grid-cols-3">
                <div><p className="text-xs font-medium uppercase text-muted-foreground">OAuth access</p><div className="mt-1 flex items-center gap-1.5 font-medium">{usps.lastTestStatus === "verified" ? <CheckCircle2 className="size-4 text-emerald-600" /> : <KeyRound className="size-4 text-amber-600" />}{usps.lastTestStatus === "verified" ? "Verified" : "Needs verification"}</div></div>
                <div><p className="text-xs font-medium uppercase text-muted-foreground">DataPlus uses</p><p className="mt-1 font-medium">Address + Rates + Tracking</p><p className="text-xs text-muted-foreground">Direct USPS scan checks run with the carrier schedule</p></div>
                <div><p className="text-xs font-medium uppercase text-muted-foreground">Token lifetime</p><p className="mt-1 font-medium">{tokenLifetimeLabel(usps.lastTokenLifetimeSeconds)}</p><p className="text-xs text-muted-foreground">Renews automatically</p></div>
                <div className="sm:col-span-3"><p className="text-xs font-medium uppercase text-muted-foreground">Capabilities</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{(usps.capabilities || []).map((capability) => <div key={capability.id} className="rounded border bg-background p-2"><div className="flex items-center justify-between gap-2"><p className="font-medium">{capability.label}</p><Badge variant={capability.status === "ready" || capability.status === "setup_available" || capability.status === "email_request_available" ? "outline" : "secondary"}>{capability.status.replaceAll("_", " ")}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{capability.detail}</p></div>)}</div></div>
              </div> : null}
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              <Button type="button" size="sm" variant="outline" disabled={!canManage || !usps?.configured || uspsRowTesting} onClick={() => void testSavedUspsConnection()}>{uspsRowTesting ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Test</Button>
              <Button type="button" size="sm" disabled={!canManage} onClick={() => openUspsDialog()}><Settings2 className="size-4" /> Configure</Button>
              <Button type="button" size="sm" variant="outline" asChild><a href="https://developers.usps.com/" target="_blank" rel="noreferrer">USPS portal <ExternalLink className="size-4" /></a></Button>
            </div>
          </div>
          {plannedProviderOrder.map((id) => {
            const provider = providers[id]
            if (!provider) return null
            return <div key={id} className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{provider.name}</p><Badge variant="secondary">Planned</Badge></div><p className="mt-1 text-sm text-muted-foreground">{provider.message}</p></div><Button type="button" size="sm" variant="outline" disabled><LockKeyhole className="size-4" /> Coming later</Button></div>
          })}
        </div>}
      </CardContent>
    </Card>

    <Dialog open={dialogOpen} onOpenChange={(open) => { if (!saving && !testing) setDialogOpen(open) }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>Configure UPS</DialogTitle><DialogDescription>Enter the OAuth credentials from UPS Developer Portal. Saving this account makes it available to direct UPS rates, tracking, and delivery evidence retrieval.</DialogDescription></DialogHeader>
        <div className="grid gap-4 py-1">
          <CredentialField label="Environment" hint="Use Production for real negotiated rates. UPS Test uses the customer integration environment."><Select value={draft.environment} onValueChange={(value) => changeEnvironment(value as "production" | "test")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="production">Production</SelectItem><SelectItem value="test">Test</SelectItem></SelectContent></Select></CredentialField>
          <CredentialField label="Client ID"><Input value={draft.clientId} onChange={(event) => setDraft((current) => ({ ...current, clientId: event.target.value }))} autoComplete="off" placeholder="UPS OAuth Client ID" /></CredentialField>
          <CredentialField label="Client Secret" hint={selectedStatus?.secretConfigured ? "A secret is saved. Leave this blank to keep it." : "Required for the first connection."}><Input type="password" value={draft.clientSecret} onChange={(event) => setDraft((current) => ({ ...current, clientSecret: event.target.value }))} autoComplete="new-password" placeholder={selectedStatus?.secretConfigured ? "Saved - enter only to replace" : "UPS OAuth Client Secret"} /></CredentialField>
          <CredentialField label="Billing account number" hint={selectedStatus?.accountConfigured ? `Account ending ${selectedStatus.accountEnding} is saved. Leave blank to keep it.` : "Use the six-character account number displayed with the UPS app."}><Input value={draft.accountNumber} onChange={(event) => setDraft((current) => ({ ...current, accountNumber: event.target.value.toUpperCase() }))} autoCapitalize="characters" maxLength={10} placeholder={selectedStatus?.accountConfigured ? `Saved ending ${selectedStatus.accountEnding}` : "Example: 6E27E5"} /></CredentialField>
          <div className="flex gap-2 rounded-md border bg-muted/25 p-3 text-xs text-muted-foreground"><LockKeyhole className="mt-0.5 size-4 shrink-0" /><p>The Client Secret is written to restricted server storage. DataPlus returns only whether a secret is configured.</p></div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0"><Button type="button" variant="outline" disabled={saving || testing} onClick={() => setDialogOpen(false)}>Cancel</Button><Button type="button" variant="outline" disabled={!canSubmit || saving || testing} onClick={() => void saveCredentials()}>{saving && !testing ? <Loader2 className="size-4 animate-spin" /> : null} Save</Button><Button type="button" disabled={!canSubmit || saving || testing} onClick={() => void verifyAndSave()}>{testing ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Verify and save</Button></DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={uspsDialogOpen} onOpenChange={(open) => { if (!uspsSaving && !uspsTesting) setUspsDialogOpen(open) }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-2xl overflow-y-auto">
        <DialogHeader><DialogTitle>Configure USPS</DialogTitle><DialogDescription>Enter the Consumer Key and Consumer Secret from the USPS Developer Portal. Optional business identifiers unlock tracking subscriptions, proof-of-delivery email requests, and authorized account pricing.</DialogDescription></DialogHeader>
        <div className="grid gap-4 py-1 sm:grid-cols-2">
          <CredentialField label="Environment" hint="TEM returns test data and watermarked labels; Production uses live USPS APIs."><Select value={uspsDraft.environment} onValueChange={(value) => changeUspsEnvironment(value as "production" | "test")}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="production">Production</SelectItem><SelectItem value="test">Test (TEM)</SelectItem></SelectContent></Select></CredentialField>
          <CredentialField label="Consumer Key" hint="USPS calls this the Consumer Key; it is used as OAuth client_id."><Input value={uspsDraft.clientId} onChange={(event) => setUspsDraft((current) => ({ ...current, clientId: event.target.value }))} autoComplete="off" placeholder="USPS Consumer Key" /></CredentialField>
          <CredentialField label="Consumer Secret" hint={selectedUspsStatus?.secretConfigured ? "A secret is saved. Leave this blank to keep it." : "Required for the first connection."}><Input type="password" value={uspsDraft.clientSecret} onChange={(event) => setUspsDraft((current) => ({ ...current, clientSecret: event.target.value }))} autoComplete="new-password" placeholder={selectedUspsStatus?.secretConfigured ? "Saved - enter only to replace" : "USPS Consumer Secret"} /></CredentialField>
          <CredentialField label="CRID" hint={selectedUspsStatus?.cridConfigured ? `CRID ending ${selectedUspsStatus.cridEnding} is saved. Leave blank to keep it.` : "Optional. Required for eligible proof-of-delivery email requests."}><Input value={uspsDraft.crid} onChange={(event) => setUspsDraft((current) => ({ ...current, crid: event.target.value.replace(/\D/g, "") }))} inputMode="numeric" placeholder="Customer Registration ID" /></CredentialField>
          <CredentialField label="Mailer ID (MID)" hint={selectedUspsStatus?.midConfigured ? `MID ending ${selectedUspsStatus.midEnding} is saved. Leave blank to keep it.` : "Optional. Required for account-wide tracking subscriptions."}><Input value={uspsDraft.mid} onChange={(event) => setUspsDraft((current) => ({ ...current, mid: event.target.value.replace(/\D/g, "") }))} inputMode="numeric" placeholder="Mailer ID" /></CredentialField>
          <CredentialField label="Pricing account type"><Select value={uspsDraft.accountType} onValueChange={(value) => setUspsDraft((current) => ({ ...current, accountType: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="EPS">Enterprise Payment System (EPS)</SelectItem><SelectItem value="PERMIT">Permit</SelectItem><SelectItem value="METER">Meter</SelectItem><SelectItem value="MID">Mailer ID</SelectItem></SelectContent></Select></CredentialField>
          <CredentialField label="Pricing / payment account" hint={selectedUspsStatus?.accountConfigured ? `Account ending ${selectedUspsStatus.accountEnding} is saved. Leave blank to keep it.` : "Optional for published rates. Authorized account access is required for contract pricing and labels."}><Input value={uspsDraft.accountNumber} onChange={(event) => setUspsDraft((current) => ({ ...current, accountNumber: event.target.value.replace(/\D/g, "") }))} inputMode="numeric" placeholder="EPS, permit, meter, or MID number" /></CredentialField>
          <CredentialField label="Webhook administrator email" hint="USPS sends subscription health notices to this address."><Input type="email" value={uspsDraft.webhookAdminEmail} onChange={(event) => setUspsDraft((current) => ({ ...current, webhookAdminEmail: event.target.value }))} autoComplete="email" placeholder="shipping@example.com" /></CredentialField>
          <div className="flex gap-2 rounded-md border bg-muted/25 p-3 text-xs text-muted-foreground sm:col-span-2"><LockKeyhole className="mt-0.5 size-4 shrink-0" /><p>The Consumer Secret and generated webhook signing secret stay in restricted server storage. USPS label purchase remains unavailable until USPS separately approves USPS Ship, Payments, and the Enterprise Payment Account.</p></div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0"><Button type="button" variant="outline" disabled={uspsSaving || uspsTesting} onClick={() => setUspsDialogOpen(false)}>Cancel</Button><Button type="button" variant="outline" disabled={!canSubmitUsps || uspsSaving || uspsTesting} onClick={() => void saveUspsCredentials()}>{uspsSaving && !uspsTesting ? <Loader2 className="size-4 animate-spin" /> : null} Save</Button><Button type="button" disabled={!canSubmitUsps || uspsSaving || uspsTesting} onClick={() => void verifyAndSaveUsps()}>{uspsTesting ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />} Verify and save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}
