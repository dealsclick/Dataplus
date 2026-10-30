export const shipmentTrackingCarriers = ["UPS", "FedEx", "USPS", "DHL", "OnTrac", "Amazon Shipping", "Other"]

export function shipmentDisplayValue(shipment: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = shipment[key]
    if (value !== undefined && value !== null && String(value).trim()) return String(value)
  }
  return ""
}

export function trackingUrlForShipment(shipment: Record<string, unknown>, carrierName = "", trackingNumber = "") {
  const importedUrl = shipmentDisplayValue(shipment, "trackingUrl", "trackingURL")
  if (/^https?:\/\//i.test(importedUrl)) return importedUrl
  const carrier = carrierName.toLowerCase()
  if (trackingNumber && carrier.includes("swiftx")) return `https://swiftx-express.com/track?trackingNumber=${encodeURIComponent(trackingNumber)}`
  if (trackingNumber && carrier.includes("speedx")) return `https://tracking.speedx.io/?trackingNumber=${encodeURIComponent(trackingNumber)}`
  if (trackingNumber && carrier.includes("gofo")) return `https://www.gofoexpress.com/tracking.html?searchID=${encodeURIComponent(trackingNumber)}`
  if (trackingNumber && carrier.includes("usps")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(trackingNumber)}`
  if (trackingNumber && carrier.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(trackingNumber)}`
  if (trackingNumber && carrier.includes("ups")) return `https://www.ups.com/track?tracknum=${encodeURIComponent(trackingNumber)}`
  if (trackingNumber && carrier.includes("dhl")) return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${encodeURIComponent(trackingNumber)}`
  if (trackingNumber && carrier.includes("ontrac")) return `https://www.ontrac.com/tracking/?number=${encodeURIComponent(trackingNumber)}`
  if (trackingNumber && carrier.includes("amazon")) return `https://track.amazon.com/tracking/${encodeURIComponent(trackingNumber)}`
  return ""
}
