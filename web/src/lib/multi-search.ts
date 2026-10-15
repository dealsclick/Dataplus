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

export function parseCsvRows(text: string, rowLimit = 10_001) {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let index = 0; index < text.length && rows.length < rowLimit; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') quoted = false
      else field += character
      continue
    }
    if (character === '"') quoted = true
    else if (character === ",") {
      row.push(field)
      field = ""
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1
      row.push(field)
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      field = ""
    } else field += character
  }
  row.push(field)
  if (row.some((value) => value.trim()) && rows.length < rowLimit) rows.push(row)
  return rows
}

const IDENTIFIER_HEADERS = new Set([
  "identifier", "id", "order", "order id", "order number", "order #", "channel order id", "channel order number",
  "marketplace order id", "marketplace order number", "sku", "alias", "alias sku", "upc", "gtin", "barcode",
  "tracking", "tracking number", "tracking #", "po", "po number", "po #", "purchase order", "purchase order number",
  "batch", "batch id", "batch number",
])

function normalizedCsvHeader(value: string) {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ")
}

export type CsvSearchTable = {
  columns: Array<{ index: number; label: string }>
  rows: string[][]
  suggestedColumn: number
  truncatedRows: boolean
}

export function csvSearchTable(text: string): CsvSearchTable {
  const parsed = parseCsvRows(text)
  if (!parsed.length) return { columns: [], rows: [], suggestedColumn: 0, truncatedRows: false }
  const width = Math.max(...parsed.map((row) => row.length))
  const first = parsed[0]
  const recognized = first.map((value, index) => IDENTIFIER_HEADERS.has(normalizedCsvHeader(value)) ? index : -1).filter((index) => index >= 0)
  const hasHeader = recognized.length > 0 || width > 1
  const columns = Array.from({ length: width }, (_, index) => ({
    index,
    label: hasHeader ? String(first[index] || `Column ${index + 1}`).replace(/^\uFEFF/, "").trim() || `Column ${index + 1}` : `Column ${index + 1}`,
  }))
  return {
    columns,
    rows: hasHeader ? parsed.slice(1) : parsed,
    suggestedColumn: recognized[0] ?? 0,
    truncatedRows: parsed.length >= 10_001,
  }
}

export function csvSearchTerms(table: CsvSearchTable, columnIndex: number, limit = MULTI_SEARCH_LIMIT) {
  return parseSearchTerms(table.rows.map((row) => row[columnIndex] || "").join("\n"), limit)
}
