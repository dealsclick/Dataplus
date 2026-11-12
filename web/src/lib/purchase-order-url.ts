export function canonicalPurchaseOrderKey(poNumber: unknown, fallbackId: unknown = "") {
  const reference = String(poNumber || "").trim()
  const internalNumber = reference.match(/^po[\s#_-]*(\d+)$/i)
  if (internalNumber) return `PO-${internalNumber[1]}`
  return String(fallbackId || reference).trim()
}

export function purchaseOrderUrl(poNumber: unknown, fallbackId: unknown = "") {
  const key = canonicalPurchaseOrderKey(poNumber, fallbackId)
  return key ? `/purchase-orders/${encodeURIComponent(key)}` : "/purchasing"
}
