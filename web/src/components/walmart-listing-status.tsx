import { useEffect, useState } from 'react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'

type Pricing = { currentPrice?: number | null; buyBoxBasePrice?: number | null; buyBoxTotalPrice?: number | null; competitorPrice?: number | null; suggestedPrice?: number | null; buyBoxWinRate?: number | null; checkedAt?: string; stale?: boolean }
type Listing = { pricingInsights?: Pricing | null; pricingMessage?: string; sku?: string; publishedStatus?: string; lifecycleStatus?: string; availability?: string; itemId?: string; itemIdMessage?: string; price?: { amount?: number; currency?: string } | null; fulfillmentLagTime?: number | null; fulfillmentCheckedAt?: string; fulfillmentError?: string; checkedAt?: string; unpublishedReasons?: string[] }
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
  const money = (value?: number | null) => typeof value === 'number' && Number.isFinite(value) ? `USD ${value.toFixed(2)}` : 'Not reported';
  const pricing = listing.pricingInsights;
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
    <section className="min-w-0 space-y-2 border-t pt-3">
      <p className="font-semibold">Buy Box &amp; competitive pricing</p>
      <dl className="grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div><dt className="text-xs text-muted-foreground">Buy Box item price</dt><dd>{money(pricing?.buyBoxBasePrice)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Buy Box total price</dt><dd className="font-semibold">{money(pricing?.buyBoxTotalPrice)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Competitor benchmark</dt><dd>{money(pricing?.competitorPrice)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Walmart suggested price</dt><dd>{money(pricing?.suggestedPrice)}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Buy Box win rate</dt><dd>{pricing?.buyBoxWinRate == null ? 'Not reported' : `${pricing.buyBoxWinRate.toFixed(2)}%`}</dd></div>
      </dl>
      <p className="text-xs text-muted-foreground">Competitor benchmark is supplied by Walmart and may reflect pricing outside Walmart. Prices are informational and do not change your selling price.</p>
      <p className={`text-xs ${pricing?.stale ? 'text-amber-600' : 'text-muted-foreground'}`}>{pricing?.checkedAt ? `${pricing.stale ? 'Outdated snapshot. ' : ''}Pricing checked ${new Date(pricing.checkedAt).toLocaleString()}.` : 'No pricing insights cached for this seller SKU. Linking or Refresh Walmart status requests background pricing updates when needed; Walmart may not report every item.'}</p>
      {listing.pricingMessage && <p className="text-xs text-amber-600">{listing.pricingMessage}</p>}
    </section>
    {listing.unpublishedReasons?.map((reason, index) => <p key={index} className="break-words rounded bg-amber-500/10 p-2 text-sm">{reason.replace(/<[^>]*>/g, '').replace(/\|\|([^@|]+)@@@[^|]+\|\|/g, '$1')}</p>)}
    {listing.itemIdMessage && !validId && <p className="break-words text-xs text-muted-foreground">{listing.itemIdMessage}</p>}
    {listing.fulfillmentError && <p className="break-words text-xs text-amber-600">Fulfillment time unavailable: {listing.fulfillmentError}</p>}
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap items-center gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>{busy ? 'Refreshing…' : 'Refresh Walmart status'}</Button><span className="text-xs text-muted-foreground">{listing.checkedAt ? `Status and price checked ${new Date(listing.checkedAt).toLocaleString()}` : 'Refresh to retrieve the seller listing.'}</span></div>
    {listing.fulfillmentCheckedAt && <p className="text-xs text-muted-foreground">Fulfillment time checked {new Date(listing.fulfillmentCheckedAt).toLocaleString()}. Cached for one hour.</p>}
  </div>
}
