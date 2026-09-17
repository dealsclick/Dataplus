import { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'

type Listing = { sku?: string; publishedStatus?: string; lifecycleStatus?: string; availability?: string; itemId?: string; itemIdMessage?: string; price?: { amount?: number; currency?: string } | null; fulfillmentLagTime?: number | null; fulfillmentCheckedAt?: string; fulfillmentError?: string; checkedAt?: string; unpublishedReasons?: string[] }
export function WalmartListingStatus({ sku }: { sku: string }) {
  const [listing, setListing] = useState<Listing>({}), [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController(); setListing({}); setError('')
    fetch(`/api/walmart/listing/details?sku=${encodeURIComponent(sku)}`, { signal: controller.signal }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); if (!controller.signal.aborted) setListing(data) }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
    return () => controller.abort()
  }, [sku])
  async function refresh() {
    setBusy(true); setError('')
    try { const response = await fetch('/api/walmart/listing/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sku }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); setListing(data) }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to refresh Walmart') }
    finally { setBusy(false) }
  }
  const status = listing.publishedStatus || 'UNVERIFIED'
  const label = (value?: string) => value ? value.replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase()) : 'Not reported'
  const amount = listing.price?.amount
  const price = typeof amount === 'number' && Number.isFinite(amount) ? `${listing.price?.currency || 'USD'} ${amount.toFixed(2)}` : 'Not reported'
  const validId = /^[1-9][0-9]*$/.test(listing.itemId || '')
  return <div className="min-w-0 space-y-3 rounded-md border p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">Walmart listing status</p><Badge variant="outline" className={status === 'PUBLISHED' ? 'border-emerald-500 text-emerald-600' : status === 'UNVERIFIED' ? 'text-muted-foreground' : 'border-amber-500 text-amber-600'}>{label(status)}</Badge></div>
    <dl className="grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      <div><dt className="text-xs text-muted-foreground">Current Walmart price</dt><dd className="font-semibold">{price}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Fulfillment time (order to shipment)</dt><dd>{listing.fulfillmentLagTime == null ? 'Not reported by Walmart' : `${listing.fulfillmentLagTime} day${listing.fulfillmentLagTime === 1 ? '' : 's'}`}</dd></div>
      <div className="min-w-0"><dt className="text-xs text-muted-foreground">Walmart item ID</dt><dd className="break-all">{validId ? <a className="font-mono font-semibold text-primary underline" href={`https://www.walmart.com/ip/${listing.itemId}`} target="_blank" rel="noopener noreferrer">{listing.itemId} ↗</a> : 'Not returned by Walmart'}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Availability</dt><dd>{label(listing.availability)}</dd></div><div><dt className="text-xs text-muted-foreground">Lifecycle</dt><dd>{label(listing.lifecycleStatus)}</dd></div><div><dt className="text-xs text-muted-foreground">Seller SKU</dt><dd className="break-all">{listing.sku || sku}</dd></div>
    </dl>
    {listing.unpublishedReasons?.map((reason, index) => <p key={index} className="break-words rounded bg-amber-500/10 p-2 text-sm">{reason.replace(/<[^>]*>/g, '').replace(/\|\|([^@|]+)@@@[^|]+\|\|/g, '$1')}</p>)}
    {listing.itemIdMessage && !validId && <p className="break-words text-xs text-muted-foreground">{listing.itemIdMessage}</p>}
    {listing.fulfillmentError && <p className="break-words text-xs text-amber-600">Fulfillment time unavailable: {listing.fulfillmentError}</p>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>{busy ? 'Refreshing…' : 'Refresh Walmart status'}</Button><span className="text-xs text-muted-foreground">{listing.checkedAt ? `Status and price checked ${new Date(listing.checkedAt).toLocaleString()}` : 'Refresh to retrieve the seller listing.'}</span></div>
    {listing.fulfillmentCheckedAt && <p className="text-xs text-muted-foreground">Fulfillment time checked {new Date(listing.fulfillmentCheckedAt).toLocaleString()}. Cached for one hour.</p>}
  </div>
}
