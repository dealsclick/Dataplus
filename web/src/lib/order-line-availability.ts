export type OrderLineAvailabilityState = "physical" | "purchase-order" | "neutral" | "fulfilled"

export type OrderLineAvailability = {
  state: OrderLineAvailabilityState
  label: string
  source: string
  route: Record<string, unknown> | null
}

const inactiveRouteStatuses = new Set([
  "canceled",
  "cancelled",
  "closed",
  "delivered",
  "expired",
  "failed",
  "fulfilled",
  "received",
  "released",
  "shipped",
  "superseded_by_receipt_stock",
  "void",
  "voided",
])

function lineRouteMatches(route: Record<string, unknown>, line: Record<string, unknown>, lineIndex: number) {
  const routeLineIndex = Number(route.lineIndex ?? -1)
  if (routeLineIndex === lineIndex) return true
  const lineSku = String(line.sku || "").trim().toLowerCase()
  return Boolean(lineSku && String(route.sku || "").trim().toLowerCase() === lineSku)
}

function routeIsActive(route: Record<string, unknown>) {
  return !inactiveRouteStatuses.has(String(route.status || "").trim().toLowerCase())
}

export function resolveOrderLineAvailability(
  line: Record<string, unknown>,
  lineIndex: number,
  unfulfilled: number,
  routes: Array<Record<string, unknown>>,
): OrderLineAvailability {
  if (unfulfilled <= 0) {
    return { state: "fulfilled", label: "Fulfilled", source: "Shipment complete", route: null }
  }

  const matchingRoutes = routes.filter((route) => lineRouteMatches(route, line, lineIndex))
  const lineRoutes = matchingRoutes.filter(routeIsActive)
  const physicalRoute = lineRoutes.find((route) => {
    const status = String(route.status || "").trim().toLowerCase()
    return ["warehouse", "inventory", "physical_stock"].includes(String(route.type || route.routeType || "").toLowerCase())
      && !["blocked", "buyer_review", "exception", "inventory_shortage"].includes(status)
  })
  if (physicalRoute) {
    return {
      state: "physical",
      label: "Physical stock",
      source: String(physicalRoute.warehouseName || "Warehouse inventory"),
      route: physicalRoute,
    }
  }

  const purchaseOrderRoute = lineRoutes.find((route) => Boolean(route.purchaseOrderId || route.purchaseOrderNumber))
  const hasInactivePurchaseOrderRoute = matchingRoutes.some((route) => !routeIsActive(route) && Boolean(route.purchaseOrderId || route.purchaseOrderNumber))
  const linePurchaseOrderNumber = String(line.purchaseOrderNumber || line.poNumber || "").trim()
  const linePurchaseOrderId = String(line.purchaseOrderId || "").trim()
  if (purchaseOrderRoute || (!hasInactivePurchaseOrderRoute && (linePurchaseOrderNumber || linePurchaseOrderId))) {
    const purchaseOrderNumber = String(purchaseOrderRoute?.purchaseOrderNumber || linePurchaseOrderNumber || "").trim()
    return {
      state: "purchase-order",
      label: purchaseOrderNumber ? `PO ${purchaseOrderNumber.replace(/^PO[#-]?/i, "")}` : "Assigned to PO",
      source: String(purchaseOrderRoute?.vendorName || line.vendor || line.supplier || "Supplier purchase order"),
      route: purchaseOrderRoute || null,
    }
  }

  return {
    state: "neutral",
    label: "No stock or PO",
    source: "Not assigned to physical inventory or a purchase order",
    route: lineRoutes[0] || null,
  }
}
