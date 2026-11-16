export function canonicalWarehouseAuditReference(auditNumber: unknown, fallbackId: unknown = "") {
  const reference = String(auditNumber || "").trim()
  const auditSequence = reference.match(/^(?:(?:audit|a)[\s#_-]*)?(\d+)$/i)
  if (auditSequence) return `A-${auditSequence[1]}`
  return String(fallbackId || reference).trim()
}

export function warehouseAuditUrl(auditNumber: unknown, fallbackId: unknown = "", mobile = false) {
  const key = canonicalWarehouseAuditReference(auditNumber, fallbackId)
  const base = mobile ? "/warehouse/mobile/audits" : "/warehouse/audits"
  return key ? `${base}/${encodeURIComponent(key)}` : base
}

export function warehouseAuditMatchesKey(audit: Record<string, unknown>, key: unknown) {
  const routeKey = String(key || "").trim()
  if (!routeKey) return false
  if (String(audit.id || "").trim().toLowerCase() === routeKey.toLowerCase()) return true
  if (String(audit.auditNumber || "").trim().toLowerCase() === routeKey.toLowerCase()) return true
  return canonicalWarehouseAuditReference(audit.auditNumber, audit.id).toLowerCase()
    === canonicalWarehouseAuditReference(routeKey).toLowerCase()
}
