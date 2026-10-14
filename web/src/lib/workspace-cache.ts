type WorkspaceCacheEntry<T> = {
  value: T
  savedAt: number
}

const workspaceCache = new Map<string, WorkspaceCacheEntry<unknown>>()
const DEFAULT_MAX_AGE_MS = 5 * 60_000

export function readWorkspaceCache<T>(key: string, maxAgeMs = DEFAULT_MAX_AGE_MS): T | null {
  const entry = workspaceCache.get(key) as WorkspaceCacheEntry<T> | undefined
  if (!entry) return null
  if (Date.now() - entry.savedAt > maxAgeMs) {
    workspaceCache.delete(key)
    return null
  }
  return entry.value
}

export function writeWorkspaceCache<T>(key: string, value: T) {
  workspaceCache.set(key, { value, savedAt: Date.now() })
}

export function invalidateWorkspaceCache(prefix = "") {
  if (!prefix) {
    workspaceCache.clear()
    return
  }
  for (const key of workspaceCache.keys()) {
    if (key.startsWith(prefix)) workspaceCache.delete(key)
  }
}
