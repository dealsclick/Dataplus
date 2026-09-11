import { WalmartAttributes, walmartSchemaNode } from './walmart-attributes'
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



export function WalmartChannel({ channel, onSave, warehouses = [] }: { warehouses?: Json[]; channel: { id: string; settings?: Json }; onSave: (id: string, patch: Json) => Promise<void> }) {

  const [rules, setRules] = useState<Json>(channel.settings || {})

  const [status, setStatus] = useState<Json>({})

  const [tab, setTab] = useState(new URLSearchParams(window.location.search).get('sku') ? 'launch' : 'connection')

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

  const [batchSkus, setBatchSkus] = useState('')

  const [batchJobId, setBatchJobId] = useState('')

  const [batch, setBatch] = useState<Json | null>(null)

  const [pendingTokens, setPendingTokens] = useState<string[]>([])

  const [category, setCategory] = useState('')

  const [query, setQuery] = useState('')

  const [types, setTypes] = useState<Json[]>([])

  const [productType, setProductType] = useState('')

  const [orderable, setOrderable] = useState('{}')

  const [visible, setVisible] = useState('{}')
  const [offerOverride, setOfferOverride] = useState('{}')
  const [contentOverride, setContentOverride] = useState('{}')

  const [schema, setSchema] = useState<Json | null>(null)

  const [feedId, setFeedId] = useState('')

  const [listing, setListing] = useState<Json | null>(null)

  const [operationKind, setOperationKind] = useState('inventory')

  const [operationKey, setOperationKey] = useState('')

  const [shipmentId, setShipmentId] = useState('')

  const [operationPreview, setOperationPreview] = useState<Json | null>(null)

  const [operationConfirm, setOperationConfirm] = useState(false)

  useEffect(() => { setRules(channel.settings || {}) }, [channel.id, channel.settings])

  useEffect(() => { let active = true; request('status').then(data => { if (active) setStatus(data) }).catch(e => { if (active) setError(e.message) }); return () => { active = false } }, [channel.id])

  async function run(fn: () => Promise<any>) {

    setBusy(true); setError(''); setMessage(''); setJob(null)

    try { const result = await fn(); if (result?.message) setMessage(result.message); if (result?.job) setJob(result.job); return result }

    catch (e) { setError(e instanceof Error ? e.message : 'Request failed') }

    finally { setBusy(false) }

  }

  const parse = (text: string) => { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Attributes must be a JSON object.'); return value }

  const dirty = JSON.stringify(rules) !== JSON.stringify(channel.settings || {})

  const enabled = channel.settings?.channelEnabled === true

  const update = (key: string, value: unknown) => { setRules(current => ({ ...current, [key]: value })); setPreview(null) }

  return <Card className="min-w-0">

    <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">

      <div className="min-w-0"><CardTitle>Walmart Marketplace <Badge variant={enabled ? 'default' : 'outline'}>{enabled ? 'Enabled' : 'Disabled'}</Badge></CardTitle><CardDescription className="mt-2">US seller-fulfilled orders, product types, UPC matching, and item launch.</CardDescription></div>

      <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" disabled={busy}>Actions</Button></DropdownMenuTrigger><DropdownMenuContent align="end">

        <DropdownMenuItem disabled={!enabled} onSelect={() => void run(() => request('connection/verify', {}))}>Verify connection</DropdownMenuItem>

        <DropdownMenuItem disabled={!enabled} onSelect={() => void run(() => request('taxonomy/refresh', {}))}>Refresh Walmart taxonomy</DropdownMenuItem>

        <DropdownMenuItem onSelect={() => void run(async () => { setStatus(await request('status')); return { message: 'Channel status refreshed.' } })}>Refresh status</DropdownMenuItem>

        <DropdownMenuItem asChild><a href="/jobs">Open Jobs and channel logs</a></DropdownMenuItem>

      </DropdownMenuContent></DropdownMenu>

    </CardHeader>

    <CardContent className="space-y-4 min-w-0">

      {error && <p role="alert" className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm break-words">{error}</p>}

      {message && <p role="status" className="text-sm">{message}</p>}

      {job && <p className="text-sm"><a className="underline" href="/jobs">Job #{job.jobNumber || job.id}</a>: {job.status}. Progress and downloadable results are in Jobs.</p>}

      <Tabs value={tab} onValueChange={setTab}>

        <TabsList className="grid w-full grid-cols-2 gap-1 sm:grid-cols-4 xl:grid-cols-8" style={{ height: 'auto' }}><TabsTrigger className="h-8" value="connection">Connection</TabsTrigger><TabsTrigger className="h-8" value="rules">Rules</TabsTrigger><TabsTrigger className="h-8" value="orders">Orders</TabsTrigger><TabsTrigger className="h-8" value="mapping">Mappings</TabsTrigger><TabsTrigger className="h-8" value="launch">Launch</TabsTrigger><TabsTrigger className="h-8" value="batch">Batch launch</TabsTrigger><TabsTrigger className="h-8" value="operations">Operations</TabsTrigger><TabsTrigger className="h-8" value="feeds">Feed results</TabsTrigger></TabsList>

        <TabsContent value="connection" className="space-y-4">

          <p className="text-sm">Credentials: <strong>{status.configured ? 'Configured on server' : 'Not configured'}</strong>. Environment: {status.environment || 'production'}.</p>

          <p className="text-sm text-muted-foreground">Set WALMART_CLIENT_ID and WALMART_CLIENT_SECRET in the server and worker environment. For sandbox, use WALMART_SANDBOX_CLIENT_ID and WALMART_SANDBOX_CLIENT_SECRET. Optional: WALMART_CHANNEL_TYPE. Restart both processes after configuring credentials.</p>

          <p className="text-sm">Enable the channel and needed operations in Rules, then use Actions → Verify connection. Successful order access does not prove item-write permission.</p>

          <a className="text-sm underline" href="https://developer.walmart.com/global-marketplace/docs/introduction-to-walmart-marketplace-apis" target="_blank" rel="noreferrer">Walmart developer documentation</a>

        </TabsContent>

        <TabsContent value="rules" className="space-y-4">

          <div className="grid gap-3 sm:grid-cols-2">

            {([['channelEnabled', 'Enable Walmart channel'], ['walmartOrdersEnabled', 'Allow order import'], ['walmartLaunchEnabled', 'Allow reviewed item launch'], ['walmartOrderScheduleEnabled', 'Schedule order imports'], ['walmartInventoryEnabled', 'Allow inventory updates and inactive-item protection'], ['walmartPriceEnabled', 'Allow reviewed price updates'], ['walmartOrderUpdatesEnabled', 'Allow order acknowledgment and tracking']] as const).map(([key, label]) => <label className="flex gap-2 items-center text-sm" key={key}><input type="checkbox" checked={rules[key] === true} onChange={e => update(key, e.target.checked)} />{label}</label>)}

            <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={rules.walmartFeedPollingEnabled !== false} onChange={e => update('walmartFeedPollingEnabled', e.target.checked)} />Automatically check submitted feed results</label><label className="grid gap-2 text-sm">Environment<select className="h-9 rounded-md border bg-background px-3" value={rules.walmartEnvironment || 'production'} onChange={e => update('walmartEnvironment', e.target.value)}><option value="production">Production</option><option value="sandbox">Sandbox</option></select></label>

            <label className="grid gap-2 text-sm">Item spec version<Input value={rules.walmartSpecVersion || ''} placeholder="Current version from Walmart Get Spec" onChange={e => update('walmartSpecVersion', e.target.value)} /></label>

            <label className="grid gap-2 text-sm">Markup above sell-unit cost (%)<Input type="number" min="0" value={rules.walmartPriceMarkupPercent ?? 30} onChange={e => update('walmartPriceMarkupPercent', Number(e.target.value))} /></label>

            <label className="grid gap-2 text-sm">Minimum gross margin (%)<Input type="number" min="0" max="99" value={rules.walmartMinMarginPercent ?? 15} onChange={e => update('walmartMinMarginPercent', Number(e.target.value))} /></label>

          </div>

          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-2 text-sm">Order import interval (hours)<Input type="number" min="1" max="24" value={rules.walmartOrderScheduleHours || 1} onChange={e => update('walmartOrderScheduleHours', Number(e.target.value))} /></label><label className="grid gap-2 text-sm">Reconcile orders created in the last (days)<Input type="number" min="1" max="180" value={rules.walmartOrderLookbackDays || 30} onChange={e => update('walmartOrderLookbackDays', Number(e.target.value))} /></label></div>

          <p className="text-xs text-muted-foreground">Scheduled imports run in production only, rechecking the selected creation-date window. Use a longer manual range to refresh older orders. Last scheduled job: {status.schedule?.jobId || 'None'}.</p>

          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-2 text-sm">Physical inventory warehouse<select className="h-9 rounded border bg-background px-3" value={rules.walmartWarehouseId || ''} onChange={e => update('walmartWarehouseId', e.target.value)}><option value="">Select a warehouse</option>{warehouses.filter(w => w.isPhysical === true && w.active !== false && w.status !== 'inactive').map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label><label className="grid gap-2 text-sm">Walmart ship node ID<Input value={rules.walmartShipNode || ''} onChange={e => update('walmartShipNode', e.target.value)} /></label><label className="grid gap-2 text-sm">Inventory safety quantity (sell units)<Input type="number" min="0" value={rules.walmartSafetyQty || 0} onChange={e => update('walmartSafetyQty', Number(e.target.value))} /></label><label className="grid gap-2 text-sm">Maximum published quantity (0 = uncapped)<Input type="number" min="0" value={rules.walmartMaxQuantity || 0} onChange={e => update('walmartMaxQuantity', Number(e.target.value))} /></label></div>

          <p className="text-xs text-muted-foreground">Inventory updates publish unreserved physical stock divided by pack size. Supplier-feed inventory is not published. Inactive products and blocked shipping classifications publish zero.</p>

          <p className="text-xs text-muted-foreground">Launch price uses the sell-unit cost, margin floor, and catalog price floor. Marketplace fees and shipping are not included in gross margin. No positive inventory is submitted during launch.</p>

          <Button disabled={busy || !dirty} onClick={() => void run(async () => { await onSave(channel.id, { settings: rules }); setStatus(await request('status')); return { message: 'Walmart rules saved.' } })}>Save rules</Button>

        </TabsContent>

        <TabsContent value="orders" className="space-y-4">

          <p className="text-sm text-muted-foreground">Import seller-fulfilled orders within a creation-date range (up to 180 days). Reimporting updates the same purchase orders while preserving DataPlus fulfillment work. Canceled and partially shipped lines retain their source quantities.</p>

          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-2 text-sm">From<Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /></label><label className="grid gap-2 text-sm">Through (inclusive)<Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /></label></div>

          <Button disabled={busy || !enabled || !channel.settings?.walmartOrdersEnabled} onClick={() => void run(() => request('orders/import', { startDate: `${startDate}T00:00:00.000Z`, endDate: `${endDate}T23:59:59.999Z` }))}>Queue order import</Button>

          <p className="text-xs text-muted-foreground">Dates use UTC. Import does not acknowledge orders or send customer notifications.</p>

        </TabsContent>

        <TabsContent value="mapping" className="space-y-4">

          <p className="text-sm">Saved taxonomy: {Number(status.taxonomy?.count || 0).toLocaleString()} product types · {status.taxonomy?.version || 'Not loaded'}. Refresh it through Actions after setting the spec version.</p>

          <label className="grid gap-2 text-sm">Master category (exact catalog category name)<Input value={category} onChange={e => setCategory(e.target.value)} /></label>

          <Button variant="outline" disabled={busy || !category} onClick={() => void run(async () => { const data = await request(`mapping?category=${encodeURIComponent(category)}`); setProductType(data.mapping?.productType || ''); setOrderable(JSON.stringify(data.mapping?.orderable || {}, null, 2)); setVisible(JSON.stringify(data.mapping?.visible || {}, null, 2)); return { message: data.mapping ? 'Saved mapping loaded.' : 'No mapping saved for this category.' } })}>Load saved mapping</Button>

          <div className="flex gap-2"><Input aria-label="Search Walmart product types" placeholder="Search Walmart product types" value={query} onChange={e => setQuery(e.target.value)} /><Button variant="outline" disabled={busy} onClick={() => void run(async () => { setTypes((await request(`taxonomy?q=${encodeURIComponent(query)}`)).rows); return {} })}>Search</Button></div>

          <div className="grid max-h-60 gap-1 overflow-auto">{types.map(type => <Button className="h-auto justify-start whitespace-normal text-left break-words" variant={productType === type.productType ? 'secondary' : 'ghost'} key={type.path} onClick={() => { setProductType(type.productType); setSchema(null) }}>{type.path}</Button>)}</div>

          <p className="text-sm break-words">Selected product type: <strong>{productType || 'None'}</strong></p>

          <Button variant="outline" disabled={busy || !enabled || !productType} onClick={() => void run(async () => { setSchema((await request('spec', { productType })).schema); return { message: 'Current item requirements loaded.' } })}>Load required attributes</Button>

          {schema && (() => {
            const properties = walmartSchemaNode(schema, walmartSchemaNode(schema, schema.properties?.MPItem).items).properties || {}
            let offerValue: Json, contentValue: Json
            try { offerValue = parse(orderable); contentValue = parse(visible) } catch { return <p className="text-sm text-destructive">Correct the advanced JSON before editing attributes.</p> }
            const contentSchema = walmartSchemaNode(schema, properties.Visible).properties?.[productType] || {}
            return <div className="grid gap-4 xl:grid-cols-2"><details className="min-w-0 rounded border p-3" open><summary className="cursor-pointer text-sm font-medium">Offer attributes</summary><div className="mt-3 max-h-96 overflow-auto pr-2"><WalmartAttributes root={schema} schema={properties.Orderable || {}} value={offerValue} offer onChange={next => setOrderable(JSON.stringify(next, null, 2))} /></div></details><details className="min-w-0 rounded border p-3" open><summary className="cursor-pointer text-sm font-medium">Product attributes</summary><div className="mt-3 max-h-96 overflow-auto pr-2"><WalmartAttributes root={schema} schema={contentSchema} value={contentValue} onChange={next => setVisible(JSON.stringify(next, null, 2))} /></div></details></div>
          })()}
          {schema && <details><summary className="text-sm cursor-pointer">Walmart required fields and allowed values</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded border p-3 text-xs">{JSON.stringify(schema, null, 2)}</pre></details>}

          <p className="text-sm text-muted-foreground">Category defaults apply to new full-item setup. Enter only verified attributes; do not guess compliance, battery, or hazardous-material answers.</p>

          <div className="grid gap-3 xl:grid-cols-2"><label className="grid gap-2 text-sm">Offer attribute defaults (JSON)<Textarea className="font-mono text-xs min-h-32" value={orderable} onChange={e => setOrderable(e.target.value)} /></label><label className="grid gap-2 text-sm">Product content defaults (JSON)<Textarea className="font-mono text-xs min-h-32" value={visible} onChange={e => setVisible(e.target.value)} /></label></div>

          <Button disabled={busy || !enabled || !productType || !category} onClick={() => void run(() => request('mapping', { category, productType, orderable: parse(orderable), visible: parse(visible) }))}>Save category mapping</Button>

        </TabsContent>

        <TabsContent value="launch" className="space-y-4">

          <p className="text-sm text-muted-foreground">Preview searches Walmart by the catalog UPC/GTIN. Existing items use offer-only matching; new items use the saved category mapping. Schema errors must be resolved before submission.</p>

          <label className="grid gap-2 text-sm">Catalog SKU<Input value={sku} onChange={e => { setSku(e.target.value); setConfirmPack(false); setPreview(null) }} /></label>

          <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmPack} onChange={e => { setConfirmPack(e.target.checked); setPreview(null) }} />I verified that this UPC/GTIN identifies the exact selling pack (required for multipacks).</label>
          <details><summary className="text-sm cursor-pointer">Per-item attribute overrides</summary><p className="my-2 text-xs text-muted-foreground">Leave these empty to use saved category defaults. SKU, identifier and calculated price cannot be overridden.</p><div className="grid gap-3 xl:grid-cols-2"><label className="grid gap-2 text-sm">Offer fields (JSON)<Textarea value={offerOverride} onChange={e => { setOfferOverride(e.target.value); setPreview(null) }} /></label><label className="grid gap-2 text-sm">Product content (JSON)<Textarea value={contentOverride} onChange={e => { setContentOverride(e.target.value); setPreview(null) }} /></label></div></details>

          <Button disabled={busy || !enabled || !sku || !channel.settings?.walmartLaunchEnabled} onClick={() => void run(async () => { setPreview(null); const data = await request('launch/preview', { sku, orderable: parse(offerOverride), visible: parse(contentOverride), confirmIdentifierPack: confirmPack }); setPreview(data); return {} })}>Match UPC and preview launch</Button>

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

