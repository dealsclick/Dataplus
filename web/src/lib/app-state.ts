import { api } from "./client-api"

export type AppReferenceName = "vendors" | "brands" | "warehouses"

export type AppProjection = {
  changed?: boolean
  version?: string
  versions?: Record<string, string>
  connections?: unknown[]
  vendors?: unknown[]
  brands?: unknown[]
  warehouses?: unknown[]
  systemSettings?: Record<string, unknown>
  connectorState?: Record<string, unknown>
}

export type AppSummary = {
  version?: string
  versions?: Record<string, string>
  workerStatus?: Record<string, unknown>
  summary?: Record<string, unknown> | null
}

let bootstrapCache: AppProjection | null = null
const referenceCache = new Map<AppReferenceName, unknown[]>()
const versionCache = new Map<string, string>()
let bootstrapRequest: Promise<AppProjection> | null = null
const referenceRequests = new Map<string, Promise<AppProjection>>()

function rememberVersions(versions?: Record<string, string>) {
  for (const [key, value] of Object.entries(versions || {})) versionCache.set(key, value)
}

export function cachedAppVersion(name: string) {
  return versionCache.get(name) || ""
}

export function clearAppStateCache() {
  bootstrapCache = null
  bootstrapRequest = null
  referenceCache.clear()
  referenceRequests.clear()
  versionCache.clear()
}

export async function loadAppBootstrap(force = false): Promise<AppProjection> {
  if (!force && bootstrapCache) return bootstrapCache
  if (!force && bootstrapRequest) return bootstrapRequest
  const request = api<AppProjection>("/api/app/bootstrap")
    .then((result) => {
      bootstrapCache = result
      rememberVersions(result.versions)
      return result
    })
    .finally(() => { bootstrapRequest = null })
  bootstrapRequest = request
  return request
}

export async function loadAppReferences(names: AppReferenceName[], force = false): Promise<AppProjection> {
  const requested = [...new Set(names)]
  const missing = force ? requested : requested.filter((name) => !referenceCache.has(name))
  if (missing.length) {
    const key = missing.slice().sort().join(",")
    let request = !force ? referenceRequests.get(key) : undefined
    if (!request) {
      request = api<AppProjection>(`/api/app/references?include=${encodeURIComponent(key)}`)
        .then((result) => {
          for (const name of missing) {
            const value = result[name]
            if (Array.isArray(value)) referenceCache.set(name, value)
          }
          rememberVersions(result.versions)
          return result
        })
        .finally(() => { referenceRequests.delete(key) })
      referenceRequests.set(key, request)
    }
    await request
  }
  return {
    changed: true,
    versions: Object.fromEntries(requested.map((name) => [name, cachedAppVersion(name)])),
    ...Object.fromEntries(requested.map((name) => [name, referenceCache.get(name) || []])),
  }
}

export function updateAppReference(name: AppReferenceName, values: unknown[]) {
  referenceCache.set(name, values)
}

export async function loadAppSummary(): Promise<AppSummary> {
  return api<AppSummary>("/api/app/summary")
}
