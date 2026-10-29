import type { ChannelConnection, ProductItem } from "../App"

export function channelFilterLabel(value: string) {
  const labels: Record<string, string> = {
    "shopify-live": "Shopify storefront live",
    "shopify-linked": "In Shopify catalog",
    "shopify-detected": "Detected in Shopify catalog",
    "shopify-missing": "Not in Shopify catalog",
    "shopify-unpublished": "In Shopify catalog - not storefront live",
    "shopify-ready": "Ready to send to Shopify",
    "shopify-not-ready": "Shopify setup incomplete",
    "shopify-price-mismatch": "Shopify price needs review",
    "ebay-live": "eBay live",
    "ebay-unverified": "eBay listing needs verification",
    "ebay-offer": "Prepared offer, not verified live",
    "ebay-detected": "Detected in eBay catalog",
    "ebay-ready": "eBay basic launch candidates",
    "ebay-validated-ready": "Ready to launch on eBay",
    "ebay-launch-not-ready": "Not ready to launch on eBay",
    "ebay-not-ready": "eBay setup incomplete",
    "ebay-sync-warning": "eBay sync warning",
    "ebay-needs-relink": "eBay needs relink",
    "ebay-missing": "Not in eBay catalog",
    "walmart-live": "Walmart live",
    "walmart-detected": "Linked to Walmart",
    "walmart-not-live": "Walmart linked, not live",
    "walmart-submitted": "Walmart submitted / awaiting publication",
    "walmart-error": "Walmart submission error",
    "walmart-launch-exception": "Walmart launch exceptions",
    "walmart-approval-required": "Walmart category approval required",
    "walmart-retryable-system": "Walmart temporary system error",
    "walmart-needs-relink": "Walmart existing offer needs linking",
    "walmart-condition-mismatch": "Walmart condition mismatch",
    "walmart-other-rejection": "Walmart other rejection",
    "walmart-accepted-not-live": "Walmart accepted, not live",
    "walmart-launch-ready": "Walmart validated launch route available (24h)",
    "walmart-launch-blocked": "Walmart validation needs attention (24h)",
    "walmart-offer-ready": "Walmart validated existing offer ready to launch (24h)",
    "walmart-offer-blocked": "Walmart existing offer needs attention (last check)",
    "walmart-new-ready": "Walmart validated new item ready for review (24h)",
    "walmart-new-blocked": "Walmart new-item fallback needs setup (last check)",
    "walmart-offer-not-found": "Walmart no existing offer match (last check)",
    "walmart-check-error": "Walmart lookup failed (last check)",
    "walmart-ready": "Walmart basic launch candidates",
    "walmart-not-ready": "Walmart setup incomplete",
    "walmart-missing": "Not linked or submitted to Walmart",
    "temu-detected": "Detected in Temu catalog",
    "temu-missing": "Not in Temu catalog",
    "whatnot-live": "Whatnot live",
    "whatnot-detected": "Detected in Whatnot inventory",
    "whatnot-ready": "Ready to send to Whatnot",
    "whatnot-not-ready": "Whatnot setup incomplete",
    "whatnot-missing": "Not in Whatnot inventory"
  }
  return labels[value] || value.replace(/^(shopify|ebay|temu|whatnot)-/, "$1 ").replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export type MarketplaceChannelKey = "shopify" | "ebay" | "walmart" | "temu" | "whatnot"

export function marketplaceChannelKey(channel: ChannelConnection): MarketplaceChannelKey | "" {
  const key = `${channel.id} ${channel.name}`.toLowerCase()
  if (key.includes("shopify")) return "shopify"
  if (key.includes("ebay")) return "ebay"
  if (key.includes("walmart")) return "walmart"
  if (key.includes("temu")) return "temu"
  if (key.includes("whatnot")) return "whatnot"
  return ""
}

function firstMarketplaceUrl(...values: unknown[]) {
  for (const value of values) {
    const candidate = String(value || "").trim()
    if (/^https?:\/\//i.test(candidate)) return candidate
  }
  return ""
}

export function marketplaceListingUrl(item: ProductItem, channel: ChannelConnection) {
  const key = `${channel.id} ${channel.name}`.toLowerCase()
  const record = item as ProductItem & Record<string, unknown>
  const channelStatuses = (item.channelStatuses || {}) as Record<string, unknown>
  const sources = (item.sources || {}) as Record<string, unknown>
  const asRecord = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const resolveNestedUrl = (...values: unknown[]) => firstMarketplaceUrl(...values.flatMap((value) => {
    const nested = asRecord(value)
    return [nested.listingUrl, nested.productUrl, nested.onlineStoreUrl, nested.externalUrl, nested.url]
  }))

  if (key.includes("walmart")) {
    const listing = asRecord(record.walmartListing)
    return listing.environment === "sandbox" ? "" : /^\d+$/.test(String(listing.itemId || "")) ? `https://www.walmart.com/ip/${listing.itemId}` : /^https:\/\/(www\.)?walmart\.com\//i.test(String(listing.itemPageUrl || "")) ? String(listing.itemPageUrl) : ""
  }
  if (key.includes("shopify")) {
    const storefrontUrl = firstMarketplaceUrl(
      item.shopifyOnlineStoreUrl,
      record.shopifyListingUrl,
      record.shopifyProductUrl,
      record.shopifyUrl,
      resolveNestedUrl(channelStatuses.shopify, sources.shopify),
    )
    if (storefrontUrl) return storefrontUrl
    const shop = String(channel.shopifyConfig?.shop || channel.settings?.shopifyStoreDomain || channel.settings?.shop || "").trim().replace(/^https?:\/\//i, "").replace(/\/$/, "")
    const productId = String(item.shopifyId || item.shopifyProductId || "").trim().split("/").pop()
    return shop && productId ? `https://${shop}/admin/products/${encodeURIComponent(productId)}` : ""
  }
  if (key.includes("ebay")) {
    const ebayUrl = firstMarketplaceUrl(
      item.ebayListing?.listingUrl,
      record.ebayListingUrl,
      record.ebayProductUrl,
      record.ebayUrl,
      resolveNestedUrl(channelStatuses.ebay, sources.ebay),
    )
    if (ebayUrl) return ebayUrl
    const listingId = String(item.ebayListing?.listingId || record.ebayListingId || item.ebayId || "").trim()
    return listingId ? `https://www.ebay.com/itm/${encodeURIComponent(listingId)}` : ""
  }
  if (key.includes("temu")) {
    const temuUrl = firstMarketplaceUrl(
      record.temuListingUrl,
      record.temuProductUrl,
      record.temuUrl,
      resolveNestedUrl(record.temuListing, channelStatuses.temu, sources.temu),
    )
    if (temuUrl) return temuUrl
    const listingId = String(item.temuProductId || item.temuListingId || item.temuId || "").trim()
    return listingId ? `https://www.temu.com/goods.html?goods_id=${encodeURIComponent(listingId)}` : ""
  }
  if (key.includes("whatnot")) {
    const whatnotUrl = firstMarketplaceUrl(
      record.whatnotListingUrl,
      record.whatnotProductUrl,
      record.whatnotUrl,
      resolveNestedUrl(record.whatnotListing, channelStatuses.whatnot, sources.whatnot),
    )
    if (whatnotUrl) return whatnotUrl
    const listingId = String(record.whatnotListingId || record.whatnotProductId || record.whatnotId || "").trim()
    return listingId ? `https://www.whatnot.com/listing/${encodeURIComponent(listingId)}` : ""
  }
  return ""
}

export function ebayListingOperatorState(item: ProductItem) {
  const listing = item.ebayListing || {}
  const status = String(listing.status || "").toLowerCase()
  const listingId = String(listing.listingId || item.ebayId || "").trim()
  const offerId = String(listing.offerId || "").trim()
  const liveState = String(listing.liveState || "").toLowerCase()
  const remoteStatus = String(listing.ebayStatus || listing.status || "").toLowerCase()
  const liveVerifiedAt = String(listing.liveVerifiedAt || "").trim()
  const verifiedLive = Boolean(listingId && liveVerifiedAt && liveState === "live" && ["active", "live", "published"].includes(remoteStatus))
  if (listing.variants?.length) {
    const live = listing.variants.filter(unit => unit.listingId && unit.status === 'published').length
    return { state: live === listing.variants.length ? 'live' as const : 'attention' as const,
      filter: live ? 'ebay-live' : 'ebay-offer', label: `${live}/${listing.variants.length} options live`,
      detail: listing.publishError || `${listing.variants.length} purchase-unit options. Open the eBay workspace for individual listing states.` }
  }
  const publishBlocked = listing.publishBlocked === true || ["publish_blocked", "publish failed", "publish_failed"].includes(status)
  if (verifiedLive) {
    return {
      state: "live" as const,
      filter: "ebay-live",
      label: "Live on eBay",
      detail: `Verified by ${listing.liveVerificationSource || "eBay"}${liveVerifiedAt ? ` on ${new Date(liveVerifiedAt).toLocaleString()}` : ""}.`
    }
  }
  if (listingId) {
    const explicitlyInactive = liveState === "not_live" || ["ended", "inactive", "not_active", "retired"].includes(remoteStatus)
    return {
      state: "attention" as const,
      filter: "ebay-unverified",
      label: explicitlyInactive ? "Not active on eBay" : "Listing needs verification",
      detail: explicitlyInactive
        ? `The listing ID is retained for history, but the completed eBay active-listing feed did not report it as live${liveVerifiedAt ? ` on ${new Date(liveVerifiedAt).toLocaleString()}` : ""}.`
        : "A listing ID exists, but DataPlus has not verified it in a completed eBay active-listing feed yet."
    }
  }
  if (offerId && publishBlocked) {
    return {
      state: "attention" as const,
      filter: "ebay-offer",
      label: "Prepared, publish blocked",
      detail: listing.publishSuggestedFix || listing.publishError || "eBay accepted the offer setup, but blocked the final publish step."
    }
  }
  if (offerId) {
    return {
      state: "attention" as const,
      filter: "ebay-offer",
      label: "Prepared, not live",
      detail: "An eBay offer exists, but no public listing ID is stored yet."
    }
  }
  return {
    state: "disabled" as const,
    filter: "ebay-missing",
    label: "Not on eBay",
    detail: "No eBay listing ID or offer ID is stored for this SKU."
  }
}

export function catalogChannelState(item: ProductItem, channel: ChannelConnection) {
  const key = `${channel.id} ${channel.name}`.toLowerCase()
  const isShopify = key.includes("shopify")
  const isEbay = key.includes("ebay")
  const isTemu = key.includes("temu")
  const isWhatnot = key.includes("whatnot")
  const record = item as ProductItem & Record<string, unknown>
  if (key.includes("walmart")) {
    const listing = (record.walmartListing || {}) as Record<string, unknown>
    const state: "live" | "attention" | "disabled" = !listing.sku ? "disabled" : listing.publishedStatus === "PUBLISHED" && listing.lifecycleStatus !== "RETIRED" && !["DATA_ERROR", "SYSTEM_ERROR"].includes(String(listing.ingestionStatus)) ? "live" : "attention"
    return { isShopify, isEbay, isTemu, isWhatnot, state, filter: "", ebayState: ebayListingOperatorState(item) }
  }
  const temuListing = record.temuListing && typeof record.temuListing === "object" ? record.temuListing as Record<string, unknown> : {}
  const whatnotListing = record.whatnotListing && typeof record.whatnotListing === "object" ? record.whatnotListing as Record<string, unknown> : {}
  const temuStatus = String(temuListing.status || record.temuStatus || "").toLowerCase()
  const whatnotStatus = String(whatnotListing.status || record.whatnotStatus || "").toLowerCase()
  const ebayState = ebayListingOperatorState(item)
  const state: "live" | "attention" | "disabled" = isShopify
    ? item.shopifyId && item.shopifyPublished ? "live" : item.shopifyId ? "attention" : "disabled"
    : isEbay
      ? ebayState.state
      : isTemu
        ? item.temuListingId || ["active", "live", "published"].includes(temuStatus) ? "live" : item.temuOfferId || item.temuProductId ? "attention" : "disabled"
        : isWhatnot
          ? record.whatnotListingId || ["active", "live", "published"].includes(whatnotStatus) ? "live" : record.whatnotProductId || record.whatnotVariantId ? "attention" : "disabled"
          : "disabled"
  const filter = isShopify ? state === "live" ? "shopify-live" : state === "attention" ? "shopify-unpublished" : "shopify-missing" : isEbay ? ebayState.filter : isTemu ? state === "live" ? "temu-live" : state === "attention" ? "temu-offer" : "temu-missing" : isWhatnot ? state === "live" ? "whatnot-live" : state === "attention" ? "whatnot-detected" : "whatnot-missing" : ""
  return { isShopify, isEbay, isTemu, isWhatnot, state, filter, ebayState }
}
