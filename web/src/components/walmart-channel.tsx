import { Switch } from './ui/switch'
import { useEffect, useState } from 'react'

import { Button } from './ui/button'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

import { Input } from './ui/input'

import { Textarea } from './ui/textarea'

import { Badge } from './ui/badge'

import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu'

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog'



type Json = Record<string, any>

async function request(path: string, body?: Json): Promise<any> {

  const response = await fetch(`/api/walmart/${path}`, { credentials: 'same-origin', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })

  const data = await response.json()

  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)

  return data

}



export function WalmartChannel({ channel, onSave, onRefresh, warehouses = [], catalogMode = false }: { catalogMode?: boolean; onRefresh?: () => void; warehouses?: Json[]; channel: { id: string; settings?: Json }; onSave: (id: string, patch: Json) => Promise<void> }) {

  const draftKey = `walmart-setup-draft:${channel.id}`
  const [edits, setEdits] = useState<Json>(() => { try { const saved = JSON.parse(sessionStorage.getItem(draftKey) || '{}'); return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {} } catch { return {} } })
  const rules = { ...channel.settings, ...edits }

  const [status, setStatus] = useState<Json>({})
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [channelType, setChannelType] = useState('direct')
  const [channelTypeId, setChannelTypeId] = useState('')

  const [tab, setTab] = useState(catalogMode ? (new URLSearchParams(window.location.search).get('skus') ? 'batch' : 'launch') : 'connection')

  const [busy, setBusy] = useState(false)

  const [message, setMessage] = useState('')

  const [error, setError] = useState('')

  const [job, setJob] = useState<Json | null>(null)

  const [startDate, setStartDate] = useState(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))

  const [endDate, setEndDate] = useState(new Date().toISOString().slice(0, 10))

  const [sku, setSku] = useState(new URLSearchParams(window.location.search).get('sku') || '')
  const [confirmPack, setConfirmPack] = useState(false)

  const [preview, setPreview] = useState<Json | null>(null)

  const [confirmation, setConfirmation] = useState(false)

  const [batchSkus, setBatchSkus] = useState(new URLSearchParams(window.location.search).get('skus') || '')

  const [batchJobId, setBatchJobId] = useState('')

  const [batch, setBatch] = useState<Json | null>(null)

  const [pendingTokens, setPendingTokens] = useState<string[]>([])

  const [savedMappings, setSavedMappings] = useState<Json[]>([])

  const [offerOverride, setOfferOverride] = useState('{}')
  const [contentOverride, setContentOverride] = useState('{}')


  const [feedId, setFeedId] = useState('')

  const [listing, setListing] = useState<Json | null>(null)

  const [operationKind, setOperationKind] = useState('inventory')

  const [operationKey, setOperationKey] = useState('')

  const [shipmentId, setShipmentId] = useState('')

  const [operationPreview, setOperationPreview] = useState<Json | null>(null)

  const [operationConfirm, setOperationConfirm] = useState(false)

  // Polling may replace channel.settings. Keep field edits until explicitly saved or discarded.
  useEffect(() => { try { if (Object.keys(edits).length) sessionStorage.setItem(draftKey, JSON.stringify(edits)); else sessionStorage.removeItem(draftKey) } catch { /* The in-memory draft still works if browser storage is unavailable. */ } }, [draftKey, edits])
  useEffect(() => {
    if (tab !== 'mapping') return
    let active = true
    request('mappings').then(data => { if (active) setSavedMappings(data.mappings || []) }).catch(error => { if (active) setError(error.message) })
    return () => { active = false }
  }, [tab])
  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return
    let active = true
    const timer = window.setInterval(() => { request('status').then(data => { if (active) { setStatus(data); if (data.taxonomy?.job?.id === job.id) setJob(data.taxonomy.job) } }).catch(() => {}) }, 5000)
    return () => { active = false; window.clearInterval(timer) }
  }, [job])

  useEffect(() => { let active = true; request('status').then(data => { if (active) { setStatus(data); setClientId(data.clientId || ''); setClientSecret(''); setChannelType(data.channelType || 'direct'); setChannelTypeId(data.channelTypeId || '') } }).catch(e => { if (active) setError(e.message) }); return () => { active = false } }, [channel.id, channel.settings?.walmartEnvironment])

  async function run(fn: () => Promise<any>) {

    setBusy(true); setError(''); setMessage(''); setJob(null)

    try { const result = await fn(); if (result?.message) setMessage(result.message); if (result?.job) setJob(result.job); return result }

    catch (e) { setError(e instanceof Error ? e.message : 'Request failed') }

    finally { setBusy(false) }

  }

  const parse = (text: string) => { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Attributes must be a JSON object.'); return value }

  const dirty = Object.keys(edits).length > 0

  const enabled = channel.settings?.channelEnabled === true
  const credentialsDirty = clientId !== (status.clientId || '') || Boolean(clientSecret) || channelType !== (status.channelType || 'direct') || channelTypeId !== (status.channelTypeId || '')
  async function verifyConnection() {
    if (!enabled) await onSave(channel.id, { settings: { ...channel.settings, channelEnabled: true } })
    const result = await request('connection/verify', {})
    setStatus(await request('status')); setTab('connection'); onRefresh?.()
    return result
  }


  const update = (key: string, value: unknown) => { setEdits(current => ({ ...current, [key]: value })); setPreview(null) }

  async function saveRules(nextTab?: string) {
    const patch = { ...edits }
    await onSave(channel.id, { settings: patch })
    setEdits(current => Object.fromEntries(Object.entries(current).filter(([key, value]) => value !== patch[key])))
    setStatus(await request('status'))
    if (nextTab) setTab(nextTab)
    return { message: 'Walmart settings saved.' }
  }
  const steps = [['connection', '1. Connection'], ['rules', '2. Features'], ['shipping', '3. Shipping'], ['mapping', '4. Categories'], ['review', '5. Review']]
  return <Card className="min-w-0">

    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">

      <div className="min-w-0"><CardTitle>{catalogMode ? 'Walmart catalog launch' : 'Walmart Marketplace setup'} <Badge variant={enabled ? 'default' : 'outline'}>{enabled ? 'Enabled' : 'Disabled'}</Badge></CardTitle><CardDescription className="mt-2">{catalogMode ? 'Review catalog items and UPC matches before submitting to Walmart.' : 'Connect your US account, choose features, then configure only what you need.'}</CardDescription></div>

      {!catalogMode && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" disabled={busy}>Actions</Button></DropdownMenuTrigger><DropdownMenuContent align="end">

        <DropdownMenuItem disabled={busy || !status.configured || credentialsDirty} onSelect={() => void run(verifyConnection)}>Verify connection</DropdownMenuItem>

        <DropdownMenuItem disabled={!enabled} onSelect={() => void run(() => request('taxonomy/refresh', {}))}>Refresh Walmart taxonomy</DropdownMenuItem>

        <DropdownMenuItem onSelect={() => void run(async () => { setStatus(await request('status')); return { message: 'Channel status refreshed.' } })}>Refresh status</DropdownMenuItem>

        <DropdownMenuItem asChild><a href="/jobs">Open Jobs and channel logs</a></DropdownMenuItem>

      </DropdownMenuContent></DropdownMenu>}

    </CardHeader>

    <CardContent className="space-y-4 min-w-0">

      {error && <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm break-words">{error}</p>}

      {message && <p role="status" className="text-sm">{message}</p>}

      {job && <p className="text-sm"><a className="underline" href="/jobs">Job #{job.jobNumber || job.id}</a>: {job.status}. Progress and downloadable results are in Jobs.</p>}

      <Tabs value={tab} onValueChange={setTab}>

        <div className="overflow-x-auto"><TabsList className="h-auto min-w-max justify-start gap-1">{(catalogMode ? [['launch', 'Single item'], ['batch', 'Selected / multiple items'], ['feeds', 'Feed results']] : steps).map(([value, label]) => <TabsTrigger key={value} value={value} className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">{label}</TabsTrigger>)}</TabsList></div>
        {!catalogMode && <div className="flex flex-wrap gap-2 border-b pb-3"><Button size="sm" variant="ghost" onClick={() => setTab('orders')}>Order imports</Button><Button size="sm" variant="ghost" onClick={() => setTab('operations')}>Inventory, prices & tracking</Button><Button size="sm" variant="ghost" onClick={() => setTab('feeds')}>Feed results</Button></div>}
        {!catalogMode && dirty && <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-400 bg-amber-50 p-3 text-sm dark:bg-amber-950"><span>Unsaved choices — background refreshes will keep your edits.</span><div className="flex gap-2"><Button size="sm" disabled={busy} onClick={() => void run(() => saveRules())}>Save changes</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => setEdits({})}>Discard changes</Button></div></div>}


        <TabsContent value="connection" className="space-y-4">

          <div className="flex flex-wrap items-center gap-2"><Badge variant={status.connection?.verified ? 'default' : 'outline'}>{status.connection?.verified ? 'Connection verified' : status.configured ? 'Ready to verify' : 'Not connected'}</Badge><span className="text-sm text-muted-foreground">Walmart US · {status.environment || 'production'}</span></div>
          <p className="text-sm text-muted-foreground">Enter the API credentials from your Walmart Developer Portal. Saved secrets stay masked and are available to the server and worker without a restart.</p>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm">Client ID<Input autoComplete="off" value={clientId} onChange={e => setClientId(e.target.value)} placeholder="Walmart client ID" /></label>
            <label className="grid gap-2 text-sm">Client secret<Input type="password" autoComplete="new-password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} placeholder={status.secretConfigured ? 'Saved — leave blank to keep' : 'Walmart client secret'} /><span className="text-xs text-muted-foreground">{status.secretConfigured ? 'A secret is saved. Enter a new value only to replace it.' : 'Required to connect your seller account.'}</span></label>
            <label className="grid gap-2 text-sm">Walmart channel type<select className="h-9 w-full min-w-0 rounded-md border bg-background px-3" value={channelType} onChange={e => { setChannelType(e.target.value); if (e.target.value === 'direct') setChannelTypeId('') }}><option value="direct">Direct seller</option><option value="assigned">Walmart-assigned channel ID</option></select></label>
            {channelType === 'assigned' && <label className="grid gap-2 text-sm">Assigned channel ID<Input value={channelTypeId} onChange={e => setChannelTypeId(e.target.value)} placeholder="ID provided by Walmart" /><span className="text-xs text-muted-foreground">Use the Consumer Channel Type issued during Walmart onboarding.</span></label>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !clientId.trim() || (channelType === 'assigned' && !channelTypeId.trim()) || (!clientSecret && !status.secretConfigured) || !credentialsDirty} onClick={() => void run(async () => { const result = await request('credentials', { environment: status.environment || 'production', clientId, clientSecret, channelType, channelTypeId }); setClientSecret(''); const next = await request('status'); setStatus(next); setClientId(next.clientId || ''); setChannelType(next.channelType || 'direct'); setChannelTypeId(next.channelTypeId || ''); setPreview(null); return result })}>Save credentials</Button>
            <Button variant="outline" disabled={busy || !status.configured || credentialsDirty} onClick={() => void run(verifyConnection)}>{enabled ? 'Verify connection' : 'Enable and verify connection'}</Button>
            <Button variant="outline" onClick={() => setTab('rules')}>Next: choose features</Button>
          </div>
          {credentialsDirty && <p className="text-xs text-muted-foreground">Save credential changes before verifying. Verification enables the channel; individual import and selling controls remain under Rules.</p>}
          {status.connection?.message && <p className="text-sm break-words">{status.connection.message}</p>}
          {status.connection?.verifiedAt && status.connection?.verified && <p className="text-xs text-muted-foreground">Verified {new Date(status.connection.verifiedAt).toLocaleString()}</p>}
          <p className="text-xs text-muted-foreground">Change production/sandbox under Rules. Each environment has its own saved credentials.</p>
          <a className="text-sm underline" href="https://developer.walmart.com/us-marketplace/reference/tokenapi" target="_blank" rel="noreferrer">Walmart credential and channel-type help</a>

        </TabsContent>

        <TabsContent value="rules" className="space-y-4">
          <div className="flex min-w-0 items-start justify-between gap-4 rounded-md border p-4"><div className="min-w-0"><label htmlFor="walmart-link-listings" className="font-medium">Automatically link existing Walmart listings</label><p id="walmart-link-description" className="mt-1 text-sm text-muted-foreground">When enabled, the worker checks now and daily for seller listings created outside DataPlus. Links by exact seller SKU first, then unique UPC/GTIN. Turning this off stops future linking and keeps saved links. Prices and inventory are unchanged.</p><p className="mt-2 text-xs text-muted-foreground">Production only. Save changes to apply. Progress and review results appear in Jobs.</p></div><Switch id="walmart-link-listings" aria-describedby="walmart-link-description" checked={rules.walmartLinkExistingEnabled === true} onCheckedChange={value => update('walmartLinkExistingEnabled', value)} /></div>
<div><h3 className="font-medium">Choose what DataPlus can do</h3><p className="text-sm text-muted-foreground">Select the features you want, then save. You can use order import without launching products. Scheduled imports run automatically only when selected.</p></div>

          <div className="grid gap-3 sm:grid-cols-2">

            {([['channelEnabled', 'Enable Walmart channel'], ['walmartOrdersEnabled', 'Allow order import'], ['walmartLaunchEnabled', 'Catalog launch (review required)'], ['walmartOrderScheduleEnabled', 'Schedule order imports'], ['walmartInventoryEnabled', 'Allow inventory updates and inactive-item protection'], ['walmartPriceEnabled', 'Allow reviewed price updates'], ['walmartOrderUpdatesEnabled', 'Allow order acknowledgment and tracking']] as const).map(([key, label]) => <label className="flex gap-2 items-center text-sm" key={key}><input type="checkbox" checked={rules[key] === true} onChange={e => update(key, e.target.checked)} />{label}</label>)}

            <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={rules.walmartFeedPollingEnabled !== false} onChange={e => update('walmartFeedPollingEnabled', e.target.checked)} />Automatically check submitted feed results</label><label className="grid gap-2 text-sm">Environment<select className="h-9 rounded-md border bg-background px-3" value={rules.walmartEnvironment || 'production'} onChange={e => update('walmartEnvironment', e.target.value)}><option value="production">Production</option><option value="sandbox">Sandbox</option></select></label>

            <label className="grid gap-2 text-sm">Item spec version override (optional)<Input value={rules.walmartSpecVersion || ''} placeholder="Use downloaded Walmart version" onChange={e => update('walmartSpecVersion', e.target.value)} /></label>

            <label className="grid gap-2 text-sm">Markup above sell-unit cost (%)<Input type="number" min="0" value={rules.walmartPriceMarkupPercent ?? 30} onChange={e => update('walmartPriceMarkupPercent', Number(e.target.value))} /></label>

            <label className="grid gap-2 text-sm">Minimum gross margin (%)<Input type="number" min="0" max="99" value={rules.walmartMinMarginPercent ?? 15} onChange={e => update('walmartMinMarginPercent', Number(e.target.value))} /></label>

          </div>

          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-2 text-sm">Order import interval (hours)<Input type="number" min="1" max="24" value={rules.walmartOrderScheduleHours || 1} onChange={e => update('walmartOrderScheduleHours', Number(e.target.value))} /></label><label className="grid gap-2 text-sm">Reconcile orders created in the last (days)<Input type="number" min="1" max="180" value={rules.walmartOrderLookbackDays || 30} onChange={e => update('walmartOrderLookbackDays', Number(e.target.value))} /></label></div>

          <p className="text-xs text-muted-foreground">Scheduled imports run in production only, rechecking the selected creation-date window. Use a longer manual range to refresh older orders. Last scheduled job: {status.schedule?.jobId || 'None'}.</p>

          <Button disabled={busy} onClick={() => void run(() => saveRules('shipping'))}>Save features and continue</Button>
        </TabsContent>
        <TabsContent value="shipping" className="space-y-4">
          <h3 className="font-medium">Download and map fulfillment centers</h3><p className="text-sm text-muted-foreground">Walmart calls fulfillment centers shipping nodes. Download your account's nodes, then select the one served by your DataPlus physical warehouse. This step is needed for inventory updates.</p>
          <Button variant="outline" disabled={busy || !enabled || credentialsDirty} onClick={() => void run(async () => { const data = await request('ship-nodes/refresh', {}); setStatus(current => ({ ...current, shipNodes: data })); return data })}>Download Walmart shipping nodes</Button>
          <p className="text-sm">{status.shipNodes?.rows?.length || 0} nodes cached · {status.shipNodes?.updatedAt ? new Date(status.shipNodes.updatedAt).toLocaleString() : 'Not downloaded'}</p>
          {(status.shipNodes?.rows || []).map((node: Json) => <div className="flex flex-wrap gap-2 rounded border p-2 text-sm" key={node.id}><strong>{node.name}</strong><span>{node.id}</span><Badge variant={node.status === 'ACTIVE' ? 'secondary' : 'outline'}>{node.status}</Badge><span>{node.city} {node.state}</span></div>)}
          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-2 text-sm">Physical inventory warehouse<select className="h-9 rounded border bg-background px-3" value={rules.walmartWarehouseId || ''} onChange={e => update('walmartWarehouseId', e.target.value)}><option value="">Select a warehouse</option>{warehouses.filter(w => w.isPhysical === true && w.active !== false && w.status !== 'inactive').map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label><label className="grid gap-2 text-sm">Walmart fulfillment center<select className="h-9 min-w-0 w-full rounded border bg-background px-3" value={rules.walmartShipNode || ''} onChange={e => update('walmartShipNode', e.target.value)}><option value="">Select a downloaded shipping node</option>{rules.walmartShipNode && !(status.shipNodes?.rows || []).some((node: Json) => node.id === rules.walmartShipNode) && <option value={rules.walmartShipNode}>Saved node {rules.walmartShipNode} — download to verify</option>}{(status.shipNodes?.rows || []).map((node: Json) => <option key={node.id} value={node.id} disabled={node.status !== 'ACTIVE'}>{node.name} · {node.id} · {node.status}</option>)}</select></label><label className="grid gap-2 text-sm">Inventory safety quantity (sell units)<Input type="number" min="0" value={rules.walmartSafetyQty || 0} onChange={e => update('walmartSafetyQty', Number(e.target.value))} /></label><label className="grid gap-2 text-sm">Maximum published quantity (0 = uncapped)<Input type="number" min="0" value={rules.walmartMaxQuantity || 0} onChange={e => update('walmartMaxQuantity', Number(e.target.value))} /></label></div>

          <p className="text-xs text-muted-foreground">Inventory updates publish unreserved physical stock divided by pack size. Supplier-feed inventory is not published. Inactive products and blocked shipping classifications publish zero.</p>

          <p className="text-xs text-muted-foreground">Launch price uses the sell-unit cost, margin floor, and catalog price floor. Marketplace fees and shipping are not included in gross margin. No positive inventory is submitted during launch.</p>

          <Button disabled={busy} onClick={() => void run(() => saveRules('mapping'))}>Save and continue to categories</Button>

        </TabsContent>

        <TabsContent value="review" className="space-y-4"><h3 className="font-medium">Review your setup</h3><p className="text-sm">Connection: {status.connection?.verified ? 'Verified' : 'Needs verification'}</p><div className="grid gap-2 sm:grid-cols-2">{[['walmartLinkExistingEnabled', 'Automatic listing links'], ['walmartOrdersEnabled', 'Order import'], ['walmartOrderScheduleEnabled', 'Scheduled imports'], ['walmartLaunchEnabled', 'Catalog launch'], ['walmartInventoryEnabled', 'Inventory updates'], ['walmartPriceEnabled', 'Price updates'], ['walmartOrderUpdatesEnabled', 'Acknowledgment and tracking']].map(([key, label]) => <p className="flex justify-between gap-2 rounded border p-2 text-sm" key={key}>{label}<Badge variant={rules[key] ? 'secondary' : 'outline'}>{rules[key] ? 'Enabled' : 'Off'}</Badge></p>)}</div><p className="text-sm">Shipping node: {rules.walmartShipNode || 'Not mapped'} · Categories cached: {status.taxonomy?.count || 0}</p>{rules.walmartInventoryEnabled && (!rules.walmartShipNode || !rules.walmartWarehouseId) && <p className="text-sm text-amber-700 dark:text-amber-400">Map a physical warehouse and an active Walmart node before inventory updates.</p>}<p className="text-sm text-muted-foreground">To launch products, select SKUs in Catalog and choose Actions → Launch on Walmart by UPC. Setup does not launch items.</p><Button disabled={busy || !dirty} onClick={() => void run(() => saveRules())}>Save setup</Button><Button asChild variant="outline"><a href="/products">Open Catalog</a></Button></TabsContent>
        <TabsContent value="orders" className="space-y-4">

          <p className="text-sm text-muted-foreground">Import seller-fulfilled orders within a creation-date range (up to 180 days). Reimporting updates the same purchase orders while preserving DataPlus fulfillment work. Canceled and partially shipped lines retain their source quantities.</p>

          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-2 text-sm">From<Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></label><label className="grid gap-2 text-sm">Through (inclusive)<Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></label></div>

          <Button disabled={busy || !enabled || !channel.settings?.walmartOrdersEnabled} onClick={() => void run(() => request('orders/import', { startDate: `${startDate}T00:00:00.000Z`, endDate: `${endDate}T23:59:59.999Z` }))}>Queue order import</Button>

          <p className="text-xs text-muted-foreground">Dates use UTC. Import does not acknowledge orders or send customer notifications.</p>

        </TabsContent>

        <TabsContent value="mapping" className="space-y-4">
          <h3 className="font-medium">Walmart categories and saved mappings</h3>
          <p className="text-sm text-muted-foreground">Map categories in Catalog → Categories → Walmart, alongside eBay and Shopify. The saved mappings appear here automatically and are used for future catalog launch previews.</p>
          <div className="flex flex-wrap gap-2"><Button asChild><a href="/categories?channel=walmart">Open Walmart category mappings</a></Button><Button variant="outline" disabled={busy || !enabled || dirty} onClick={() => void run(() => request('taxonomy/refresh', {}))}>Download and cache Walmart categories</Button></div>
          <p className="text-sm">{Number(status.taxonomy?.count || 0).toLocaleString()} product types cached · Version {status.taxonomy?.version || 'Not loaded'} · {status.taxonomy?.updatedAt ? new Date(status.taxonomy.updatedAt).toLocaleString() : 'Never downloaded'}</p>
          {status.taxonomy?.job && <p className="text-sm">Download {status.taxonomy.job.status}: {status.taxonomy.job.message}</p>}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(async () => { const [info, data] = await Promise.all([request('status'), request('mappings')]); setStatus(info); setSavedMappings(data.mappings || []); return { message: 'Saved mappings refreshed.' } })}>Refresh saved mappings</Button>
          <div className="space-y-2">{savedMappings.length ? savedMappings.map(mapping => <div className="grid min-w-0 gap-1 rounded border p-3 text-sm" key={mapping.category}><strong className="break-words">{mapping.category}</strong><span className="break-words">{mapping.path || mapping.productType}</span><span className="text-xs text-muted-foreground">Version {mapping.version} · Saved {new Date(mapping.updatedAt).toLocaleString()}</span><a className="text-primary underline" href={`/categories/${encodeURIComponent(mapping.category)}?scope=main&channel=walmart`}>Open category mapping</a></div>) : <p className="rounded border p-3 text-sm text-muted-foreground">No Walmart category mappings saved yet. Open Categories, choose Walmart, and open a DataPlus category to map it.</p>}</div>
          <Button variant="outline" onClick={() => setTab('review')}>Continue to review</Button>
        </TabsContent>

        <TabsContent value="launch" className="space-y-4">
          {(!status.connection?.verified || !channel.settings?.walmartLaunchEnabled) && <p className="rounded border p-3 text-sm">{!status.connection?.verified ? 'Verify the connection' : 'Enable catalog launch'} in <a className="underline" href="/channels?channel=Walmart">Walmart setup</a> before preparing items.</p>}
          <p className="text-sm text-muted-foreground">Preview searches Walmart by the catalog UPC/GTIN. Existing items use offer-only matching; new items use the saved category mapping. Schema errors must be resolved before submission.</p>

          <label className="grid gap-2 text-sm">Catalog SKU<Input value={sku} onChange={e => { setSku(e.target.value); setConfirmPack(false); setPreview(null) }} /></label>

          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmPack} onChange={e => { setConfirmPack(e.target.checked); setPreview(null) }} />I verified that this UPC/GTIN identifies the exact selling pack (required for multipacks).</label>
          <details><summary className="text-sm cursor-pointer">Per-item attribute overrides</summary><p className="my-2 text-xs text-muted-foreground">Leave these empty to use saved category defaults. SKU, identifier and calculated price cannot be overridden.</p><div className="grid gap-3 xl:grid-cols-2"><label className="grid gap-2 text-sm">Offer fields (JSON)<Textarea value={offerOverride} onChange={e => { setOfferOverride(e.target.value); setPreview(null) }} /></label><label className="grid gap-2 text-sm">Product content (JSON)<Textarea value={contentOverride} onChange={e => { setContentOverride(e.target.value); setPreview(null) }} /></label></div></details>

          <Button disabled={busy || !enabled || !sku || !status.connection?.verified || credentialsDirty || !channel.settings?.walmartLaunchEnabled} onClick={() => void run(async () => { setPreview(null); const data = await request('launch/preview', { sku, orderable: parse(offerOverride), visible: parse(contentOverride), confirmIdentifierPack: confirmPack }); setPreview(data); return {} })}>Match UPC and preview launch</Button>

          {preview && <div className="space-y-3 rounded-md border p-3 min-w-0"><p className="text-sm"><Badge variant={preview.errors.length ? 'destructive' : 'secondary'}>{preview.errors.length ? 'Needs review' : 'Ready to submit'}</Badge> {preview.sku} · {preview.feedType === 'MP_ITEM_MATCH' ? 'Existing item match' : 'Full item setup'} · ${preview.price.toFixed(2)}</p><p className="text-xs break-words">{preview.identifier.kind.toUpperCase()}: {preview.identifier.value} · {preview.productType || 'Walmart matched catalog item'} · {preview.environment}</p>{preview.errors.map((item: Json, i: number) => <p key={i} className="text-sm break-words text-red-600 dark:text-red-400">{item.field}: {item.message}</p>)}<details><summary className="text-sm cursor-pointer">Review exact feed</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(preview.payload, null, 2)}</pre></details><Button disabled={busy || preview.errors.length > 0} onClick={() => { setPendingTokens([preview.token]); setConfirmation(true) }}>Submit reviewed item</Button></div>}

        </TabsContent>

        <TabsContent value="batch" className="space-y-4">

          <p className="text-sm text-muted-foreground">Prepare up to 100 catalog SKUs using saved category defaults. Only individually valid previews can be submitted. Review the prices and match paths below; previews expire after 30 minutes.</p>

          <label className="grid gap-2 text-sm">Catalog SKUs, one per line<Textarea value={batchSkus} onChange={e => setBatchSkus(e.target.value)} /></label>

          <Button disabled={busy || !enabled || !batchSkus.trim()} onClick={() => void run(async () => { const result = await request('launch/batch-preview', { skus: batchSkus.split(/[\n,]+/).map(s => s.trim()).filter(Boolean) }); if (!result.duplicate) { setBatchJobId(result.job.id); setBatch(null) }; return result })}>Queue batch preview</Button>

          <label className="grid gap-2 text-sm">Preview job ID<Input value={batchJobId} onChange={e => setBatchJobId(e.target.value)} /></label>

          <Button variant="outline" disabled={busy || !batchJobId} onClick={() => void run(async () => { setBatch(await request(`launch/batch?jobId=${encodeURIComponent(batchJobId)}`)); return {} })}>Load batch review</Button>

          {batch && <div className="space-y-3"><p className="text-sm">{batch.complete ? 'Preview complete' : 'Still preparing previews'} · {batch.rows.length} items</p><div className="max-h-96 overflow-auto rounded border">{batch.rows.map((row: Json) => <div key={row.sku} className="border-b p-3 text-sm break-words"><strong>{row.sku}</strong> · {row.feedType || 'Blocked'} · {row.price ? `$${row.price.toFixed(2)}` : 'No price'}<Badge className="ml-2" variant={row.errors.length ? 'destructive' : 'secondary'}>{row.errors.length ? 'Needs review' : 'Ready'}</Badge>{row.errors.map((e: Json, i: number) => <p key={i}>{e.field}: {e.message}</p>)}</div>)}</div><Button disabled={busy || !batch.complete || !batch.rows.some((r: Json) => r.token && !r.errors.length)} onClick={() => { setPendingTokens(batch.rows.filter((r: Json) => r.token && !r.errors.length).map((r: Json) => r.token)); setPreview(null); setConfirmation(true) }}>Submit ready items</Button></div>}

        </TabsContent>

        <TabsContent value="operations" className="space-y-4">

          <p className="text-sm text-muted-foreground">Review individual live updates before queuing them. Acknowledgment confirms your intent to fulfill an order. Tracking uploads use an already completed DataPlus shipment and may trigger Walmart customer notifications.</p>

          <label className="grid gap-2 text-sm">Operation<select className="h-9 rounded border bg-background px-3" value={operationKind} onChange={e => { setOperationKind(e.target.value); setOperationPreview(null) }}><option value="inventory">Publish physical inventory</option><option value="price">Update price from rules</option><option value="acknowledge">Acknowledge an order</option><option value="tracking">Upload completed shipment tracking</option></select></label>

          <label className="grid gap-2 text-sm">{['inventory','price'].includes(operationKind) ? 'Catalog SKU' : 'DataPlus order ID or order number'}<Input value={operationKey} onChange={e => { setOperationKey(e.target.value); setOperationPreview(null) }} /></label>

          {operationKind === 'tracking' && <label className="grid gap-2 text-sm">Completed DataPlus shipment ID<Input value={shipmentId} onChange={e => { setShipmentId(e.target.value); setOperationPreview(null) }} /></label>}

          <Button disabled={busy || !enabled || !operationKey} onClick={() => void run(async () => { setOperationPreview(null); setOperationPreview(await request('operations/preview', { kind: operationKind, key: operationKey, shipmentId })); return {} })}>Preview update</Button>

          {operationPreview && <div className="space-y-3 rounded border p-3"><p className="text-sm">{operationPreview.kind} · {operationPreview.key} · {operationPreview.environment}</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(operationPreview.body || { action: 'Acknowledge all open lines' }, null, 2)}</pre><Button disabled={busy} onClick={() => setOperationConfirm(true)}>Queue reviewed update</Button></div>}

        </TabsContent>

        <TabsContent value="feeds" className="space-y-4">

          <p className="text-sm text-muted-foreground">Feed acceptance and ingestion success do not prove that the listing is published. Check both the feed and seller item status. Detailed ingestion errors are downloadable from the result job.</p>

          <label className="grid gap-2 text-sm">Catalog SKU<Input value={sku} onChange={e => setSku(e.target.value)} /></label>

          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !sku} onClick={() => void run(async () => { const data = await request(`listing?sku=${encodeURIComponent(sku)}`); setListing(data); if (data.submission?.feedId) setFeedId(data.submission.feedId); return {} })}>Load submission</Button><Button variant="outline" disabled={busy || !enabled || !sku} onClick={() => void run(async () => { setListing(await request('listing/verify', { sku })); return {} })}>Check seller item status</Button></div>

          {listing && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded border p-3 text-xs">{JSON.stringify(listing, null, 2)}</pre>}

          <label className="grid gap-2 text-sm">Walmart feed ID<Input value={feedId} onChange={e => setFeedId(e.target.value)} /></label>

          <Button disabled={busy || !enabled || !feedId} onClick={() => void run(() => request('feeds/refresh', { feedId }))}>Queue feed status check</Button>

        </TabsContent>

      </Tabs>

      <AlertDialog open={operationConfirm} onOpenChange={setOperationConfirm}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Apply the reviewed Walmart update?</AlertDialogTitle><AlertDialogDescription>This sends the displayed {operationPreview?.kind} update for {operationPreview?.key} to Walmart {operationPreview?.environment}. Order updates can trigger customer notifications.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void run(async () => { const result = await request('operations/apply', { token: operationPreview?.token }); if (!result.duplicate) setOperationPreview(null); return result })}>Apply update</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

      <AlertDialog open={confirmation} onOpenChange={setConfirmation}><AlertDialogContent className="max-h-[90dvh] overflow-y-auto"><AlertDialogHeader><AlertDialogTitle>Submit this item to Walmart?</AlertDialogTitle><AlertDialogDescription>Submit {pendingTokens.length} reviewed item(s) using the prices shown in the preview, in {status.environment || "production"}. Walmart may publish the offer after processing. Review the returned feed results before retrying.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void run(async () => { const result = await request('launch/apply', { tokens: pendingTokens }); if (!result.duplicate) { setPreview(null); setBatch(null) }; return result })}>Submit item</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>

    </CardContent>

  </Card>

}

