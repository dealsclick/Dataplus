import type { SVGProps } from "react"

type OrderLike = Record<string, unknown> | null | undefined

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function values(value: unknown) {
  return Array.isArray(value) ? value.map((entry) => String(entry || "").trim()).filter(Boolean) : []
}

export const EBAY_LIVE_FILTER_VALUE = "ebay_live"
export const TIKTOK_LIVE_FILTER_VALUE = "tiktok_live"

export function isEbayLiveOrder(order: OrderLike) {
  const row = record(order)
  const external = record(row.external)
  const live = record(row.ebayLive)
  const externalLive = record(external.ebayLive)
  const items = Array.isArray(row.items) ? row.items.map(record) : []
  return row.isEbayLive === true
    || external.isEbayLive === true
    || live.isLive === true
    || String(row.salesOrigin || external.salesOrigin || "").toLowerCase() === EBAY_LIVE_FILTER_VALUE
    || values(live.eventIds).length > 0
    || values(externalLive.eventIds).length > 0
    || items.some((item) => item.isEbayLive === true || String(item.purchaseSource || "").toUpperCase() === "EBAY_LIVE" || Boolean(item.ebayLiveEventId))
}

export function ebayLiveEventIds(order: OrderLike) {
  const row = record(order)
  const external = record(row.external)
  const live = record(row.ebayLive)
  const externalLive = record(external.ebayLive)
  const items = Array.isArray(row.items) ? row.items.map(record) : []
  return [...new Set([
    ...values(live.eventIds),
    ...values(externalLive.eventIds),
    ...items.map((item) => String(item.ebayLiveEventId || record(item.ebayLiveContext).eventId || "").trim()).filter(Boolean),
  ])]
}

export function isTikTokLiveOrder(order: OrderLike) {
  const row = record(order)
  const external = record(row.external)
  const live = record(row.tiktokLive)
  const externalLive = record(external.tiktokLive)
  const items = Array.isArray(row.items) ? row.items.map(record) : []
  return row.isTikTokLive === true
    || external.isTikTokLive === true
    || live.isLive === true
    || externalLive.isLive === true
    || String(row.salesOrigin || external.salesOrigin || "").toLowerCase() === TIKTOK_LIVE_FILTER_VALUE
    || values(live.contentIds).length > 0
    || values(externalLive.contentIds).length > 0
    || items.some((item) => item.isTikTokLive === true || ["LIVE", "PRE_LIVE"].includes(String(item.tiktokLiveContentType || "").toUpperCase()))
}

export function tiktokLiveContentIds(order: OrderLike) {
  const row = record(order)
  const external = record(row.external)
  const live = record(row.tiktokLive)
  const externalLive = record(external.tiktokLive)
  const items = Array.isArray(row.items) ? row.items.map(record) : []
  return [...new Set([
    ...values(live.contentIds),
    ...values(externalLive.contentIds),
    ...items.map((item) => String(item.tiktokLiveContentId || "").trim()).filter(Boolean),
  ])]
}

export function tiktokLiveCreators(order: OrderLike) {
  const row = record(order)
  const external = record(row.external)
  const live = record(row.tiktokLive)
  const externalLive = record(external.tiktokLive)
  const items = Array.isArray(row.items) ? row.items.map(record) : []
  return [...new Set([
    ...values(live.creators),
    ...values(externalLive.creators),
    ...items.map((item) => String(item.tiktokLiveCreator || "").trim()).filter(Boolean),
  ])]
}

export function orderChannelFilterValue(order: OrderLike) {
  if (isTikTokLiveOrder(order)) return TIKTOK_LIVE_FILTER_VALUE
  if (isEbayLiveOrder(order)) return EBAY_LIVE_FILTER_VALUE
  const row = record(order)
  return String(row.source || row.channelSource || row.salesChannel || row.sourceChannel || "").trim()
}

export function orderChannelFilterLabel(value: unknown) {
  if (String(value || "") === EBAY_LIVE_FILTER_VALUE) return "eBay Live"
  if (String(value || "") === TIKTOK_LIVE_FILTER_VALUE) return "TikTok LIVE"
  return String(value || "")
}

export function EbayLiveMark({ className = "", ...props }: SVGProps<SVGSVGElement>) {
  return <svg
    aria-label="eBay Live sale"
    className={`inline-block h-3.5 w-10 shrink-0 align-middle drop-shadow-sm ${className}`.trim()}
    role="img"
    viewBox="0 0 40 14"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <title>eBay Live sale</title>
    <rect width="40" height="14" rx="3" fill="#ec4899" />
    <circle cx="6.5" cy="7" r="2" fill="white" />
    <text x="11" y="9.7" fill="white" fontFamily="Arial, sans-serif" fontSize="7.3" fontWeight="700" letterSpacing="0.4">LIVE</text>
  </svg>
}

export function TikTokLiveMark({ className = "", ...props }: SVGProps<SVGSVGElement>) {
  return <svg
    aria-label="TikTok LIVE sale"
    className={`inline-block h-3.5 w-[52px] shrink-0 align-middle drop-shadow-sm ${className}`.trim()}
    role="img"
    viewBox="0 0 52 14"
    xmlns="http://www.w3.org/2000/svg"
    {...props}
  >
    <title>TikTok LIVE sale</title>
    <rect x="0.5" y="0.5" width="51" height="13" rx="3" fill="#111827" stroke="#25f4ee" />
    <circle cx="6.5" cy="7" r="2" fill="#fe2c55" />
    <text x="11" y="9.7" fill="white" fontFamily="Arial, sans-serif" fontSize="7.1" fontWeight="700" letterSpacing="0.2">TT LIVE</text>
  </svg>
}
