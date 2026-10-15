import type { ClipboardEvent } from "react"

export const MULTI_SEARCH_LIMIT = 100

export function parseSearchTerms(value: unknown, limit = MULTI_SEARCH_LIMIT) {
  const terms = String(value || "")
    .split(/[\r\n,;]+/)
    .map((term) => term.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean)
  return [...new Set(terms.map((term) => term.toLowerCase()))].slice(0, Math.max(1, limit))
}

export function isMultiSearch(value: unknown) {
  return parseSearchTerms(value).length > 1
}

function collectPrimitiveValues(value: unknown, output: string[], depth = 0) {
  if (value === null || value === undefined || depth > 5 || output.length >= 500) return
  if (["string", "number"].includes(typeof value)) {
    const normalized = String(value).trim().toLowerCase()
    if (normalized) output.push(normalized)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectPrimitiveValues(entry, output, depth + 1))
    return
  }
  if (typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((entry) => collectPrimitiveValues(entry, output, depth + 1))
  }
}

export function matchesSearch(record: unknown, query: unknown, singleSearchText?: string) {
  const terms = parseSearchTerms(query)
  if (!terms.length) return true
  if (terms.length === 1) {
    const searchable = singleSearchText ?? JSON.stringify(record)
    return String(searchable || "").toLowerCase().includes(terms[0])
  }
  const values: string[] = []
  collectPrimitiveValues(record, values)
  const exactValues = new Set(values)
  const compactValues = new Set(values.map((value) => value.replace(/[^a-z0-9]+/g, "")).filter(Boolean))
  return terms.some((term) => exactValues.has(term) || compactValues.has(term.replace(/[^a-z0-9]+/g, "")))
}

export function normalizePastedSearch(event: ClipboardEvent<HTMLInputElement>, currentValue: string, onChange: (value: string) => void) {
  const pasted = event.clipboardData.getData("text")
  if (!/[\r\n,;]/.test(pasted)) return
  event.preventDefault()
  const input = event.currentTarget
  const start = input.selectionStart ?? currentValue.length
  const end = input.selectionEnd ?? start
  const inserted = parseSearchTerms(pasted).join(", ")
  onChange(`${currentValue.slice(0, start)}${inserted}${currentValue.slice(end)}`)
}
