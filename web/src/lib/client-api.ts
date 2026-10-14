import { invalidateWorkspaceCache } from "./workspace-cache"

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  })
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
