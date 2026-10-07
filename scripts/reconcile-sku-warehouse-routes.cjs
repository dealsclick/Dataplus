const crypto = require("crypto")
const postgres = require("../db")

function argument(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : ""
}

function terminalOrder(order = {}) {
  return [order.status, order.operationalStatus, order.workflowStatus, order.fulfillmentStatus]
    .map((value) => String(value || "").toLowerCase())
    .some((value) => ["completed", "shipped", "delivered", "canceled", "cancelled", "void", "voided", "deleted", "refunded"].includes(value))
}

function routeInventoryQty(route = {}) {
  const multiplier = Math.max(1, Number(route.inventoryMultiplier || 1))
  return Math.max(0, Number(route.inventoryQty || 0) || Number(route.qty || route.quantity || 0) * multiplier)
}

async function main() {
  const sku = argument("sku")
  const warehouseId = argument("warehouse")
  const apply = process.argv.includes("--apply")
  if (!sku || !warehouseId) throw new Error("Use --sku SKU --warehouse WAREHOUSE_ID [--apply].")

  const product = await postgres.readProductByKey(sku)
  if (!product) throw new Error(`Product ${sku} was not found.`)
  const stock = (product.warehouseStock || []).find((row) => String(row.warehouseId || "") === warehouseId)
  if (!stock) throw new Error(`Warehouse ${warehouseId} has no stock row for ${sku}.`)
  const targetQty = Math.max(0, Number(stock.qty || 0))
  const orders = await postgres.listOrders({ sku, limit: 5000 })
  const candidates = []
  for (const order of orders) {
    if (terminalOrder(order)) continue
    for (const route of order.fulfillmentRoutes || []) {
      const status = String(route.status || "").toLowerCase()
      if (String(route.type || "").toLowerCase() !== "warehouse"
        || String(route.warehouseId || "") !== warehouseId
        || String(route.sku || "").toLowerCase() !== sku.toLowerCase()
        || ["unallocated", "inventory_shortage", "shipped", "delivered", "fulfilled", "closed", "canceled", "cancelled", "void", "expired"].includes(status)) continue
      candidates.push({ order, route, inventoryQty: routeInventoryQty(route) })
    }
  }
  candidates.sort((left, right) => new Date(right.route.allocatedAt || right.route.createdAt || right.route.updatedAt || 0).getTime()
    - new Date(left.route.allocatedAt || left.route.createdAt || left.route.updatedAt || 0).getTime())
  let remainingReserved = candidates.reduce((sum, row) => sum + row.inventoryQty, 0)
  const releases = []
  for (const candidate of candidates) {
    if (remainingReserved <= targetQty) break
    releases.push(candidate)
    remainingReserved = Math.max(0, remainingReserved - candidate.inventoryQty)
  }
  const summary = {
    mode: apply ? "apply" : "dry-run",
    sku,
    warehouseId,
    onHand: targetQty,
    activeRouteReservations: candidates.reduce((sum, row) => sum + row.inventoryQty, 0),
    reservationsAfter: remainingReserved,
    affectedOrders: releases.map(({ order, route, inventoryQty }) => ({ orderId: order.id, orderNumber: order.orderNumber || order.id, routeId: route.id, inventoryQty }))
  }
  if (!apply) return console.log(JSON.stringify(summary, null, 2))

  const now = new Date().toISOString()
  const changedOrders = new Map()
  for (const { order, route, inventoryQty } of releases) {
    route.previousStatus = route.status || "allocated"
    route.status = "unallocated"
    route.inventoryQty = 0
    route.inventoryAdjustmentReleasedQty = inventoryQty
    route.allocationReleasedAt = now
    route.allocationReleaseReason = "Inventory reconciliation after physical stock adjustment"
    route.shippingRateReview = null
    route.updatedAt = now
    order.allocationStatus = "unallocated"
    order.operationalStatus = "buyer_review"
    order.workflowStatus = "buyer_review"
    order.workflowUpdatedAt = now
    order.updatedAt = now
    order.workflowExceptions = Array.isArray(order.workflowExceptions) ? order.workflowExceptions : []
    if (!order.workflowExceptions.some((entry) => entry.status !== "resolved" && entry.type === "inventory_adjustment_released_allocation" && String(entry.sku || "").toLowerCase() === sku.toLowerCase())) {
      order.workflowExceptions.push({
        id: crypto.randomUUID(),
        type: "inventory_adjustment_released_allocation",
        severity: "warning",
        owner: "Warehouse",
        sku,
        status: "open",
        description: `${inventoryQty} unit(s) of ${sku} were unallocated because physical inventory is ${targetQty}. Reallocate stock or review purchasing supply.`,
        createdAt: now,
        updatedAt: now
      })
    }
    changedOrders.set(String(order.id), order)
  }
  await Promise.all([...changedOrders.values()].map((order) => postgres.saveOrder(order)))
  stock.reserved = remainingReserved
  stock.available = Math.max(0, targetQty - remainingReserved)
  stock.updatedAt = now
  product.reserved = (product.warehouseStock || []).reduce((sum, row) => sum + Math.max(0, Number(row.reserved || 0)), 0)
  product.updatedAt = now
  await postgres.upsertProductsFromState([product])
  await postgres.upsertInventoryLevelsFromProducts([product])
  console.log(JSON.stringify({ ...summary, savedOrders: changedOrders.size }, null, 2))
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error)
  process.exit(1)
})
