import { invalidateWorkspaceCache } from "./workspace-cache"

type ClientPerformanceSample = {
  workspace: string
  method: string
  statusCode: number
  ok: boolean
  apiMs: number
}

const clientPerformanceQueue: ClientPerformanceSample[] = []
let clientPerformanceTimer: ReturnType<typeof setTimeout> | null = null
let clientPerformanceFlushPending = false

function performanceWorkspace(path = "") {
  const resource = String(path).split("?")[0].split("/").filter(Boolean)[1] || "other"
  if (["orders", "drafts", "returns", "customers"].includes(resource)) return "orders"
  if (["purchase-orders", "purchasing", "vendors"].includes(resource)) return "purchasing"
  if (["products", "catalog", "categories", "brands", "source-catalog"].includes(resource)) return "catalog"
  if (["reports", "reporting", "accounting", "settlements", "transactions", "finance"].includes(resource)) return "reports"
  if (["fulfillment", "shipping", "print-agent"].includes(resource)) return "fulfillment"
  if (["warehouse", "inventory", "receiving", "bins"].includes(resource)) return "warehouse"
  if (["channels", "walmart", "ebay", "shopify", "temu", "veeqo"].includes(resource)) return "channels"
  if (["jobs", "operations", "imports"].includes(resource)) return "jobs"
  if (["system", "system-settings", "order-workflows", "organization", "users", "auth", "performance"].includes(resource)) return "settings"
  return "other"
}

async function flushClientPerformanceQueue() {
  if (clientPerformanceFlushPending) return
  if (clientPerformanceTimer) clearTimeout(clientPerformanceTimer)
  clientPerformanceTimer = null
  if (!clientPerformanceQueue.length) return
  clientPerformanceFlushPending = true
  const samples = clientPerformanceQueue.splice(0, 100)
  try {
    await fetch("/api/performance/client", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ samples }),
      keepalive: true,
    })
  } catch {
    clientPerformanceQueue.unshift(...samples.slice(-50))
  } finally {
    clientPerformanceFlushPending = false
  }
  if (clientPerformanceQueue.length) clientPerformanceTimer = setTimeout(() => void flushClientPerformanceQueue(), 30_000)
}

function recordClientPerformance(sample: ClientPerformanceSample) {
  clientPerformanceQueue.push(sample)
  if (clientPerformanceQueue.length > 100) clientPerformanceQueue.shift()
  if (clientPerformanceQueue.length >= 20) {
    queueMicrotask(() => void flushClientPerformanceQueue())
  } else if (!clientPerformanceTimer) {
    clientPerformanceTimer = setTimeout(() => void flushClientPerformanceQueue(), 30_000)
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const shouldMeasure = path.startsWith("/api/") && !path.startsWith("/api/performance/") && !path.startsWith("/api/fulfillment/diagnostics/client")
  const startedAt = shouldMeasure ? performance.now() : 0
  let statusCode = 0
  let ok = false
  try {
    const response = await fetch(path, {
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      ...options,
    })
    statusCode = response.status
    ok = response.ok
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      if (payload.companyWorkspace === "/organization") window.location.assign("/organization")
      const missing = payload.missingPermission && typeof payload.missingPermission === "object" ? payload.missingPermission : null
      const missingLabel = missing?.area && missing?.action ? ` Missing permission: ${missing.area}/${missing.action}.` : ""
      const error = new Error(`${payload.error || payload.message || `Request failed: ${response.status}`}${missingLabel}`) as Error & { status?: number; payload?: Record<string, unknown> }
      error.status = response.status
      error.payload = payload
      throw error
    }
    const method = String(options.method || "GET").toUpperCase()
    if (!["GET", "HEAD", "OPTIONS"].includes(method) && !path.includes("/preview") && !path.includes("/search")) invalidateWorkspaceCache()
    return payload as T
  } finally {
    if (shouldMeasure) recordClientPerformance({
      workspace: performanceWorkspace(path),
      method: String(options.method || "GET").toUpperCase(),
      statusCode,
      ok,
      apiMs: Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100),
    })
  }
}

export function dateLabel(value?: string) {
  if (!value) return "Never"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Never"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

export function numberLabel(value?: unknown) {
  return Number(value || 0).toLocaleString()
}

export function moneyLabel(value?: unknown) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0))
}
