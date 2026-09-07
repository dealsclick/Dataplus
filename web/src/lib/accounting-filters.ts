export const accountingDatePresets = [
  { value: "all", label: "All dates" }, { value: "today", label: "Today" },
  { value: "last7", label: "Last 7 days" }, { value: "last30", label: "Last 30 days" },
  { value: "thisQuarter", label: "This quarter" }, { value: "lastQuarter", label: "Last quarter" },
  { value: "ytd", label: "Year to date" }, { value: "lastYear", label: "Last year" },
  { value: "custom", label: "Custom range" },
] as const

export function accountingDateBounds(preset: string, now = new Date()) {
  const year = now.getFullYear(), month = now.getMonth(), day = now.getDate()
  const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
  const today = key(new Date(year, month, day)), quarter = Math.floor(month / 3) * 3
  switch (preset) {
    case "today": return { from: today, to: today }
    case "last7": return { from: key(new Date(year, month, day - 6)), to: today }
    case "last30": return { from: key(new Date(year, month, day - 29)), to: today }
    case "thisQuarter": return { from: key(new Date(year, quarter, 1)), to: today }
    case "lastQuarter": return { from: key(new Date(year, quarter - 3, 1)), to: key(new Date(year, quarter, 0)) }
    case "ytd": return { from: key(new Date(year, 0, 1)), to: today }
    case "lastYear": return { from: key(new Date(year - 1, 0, 1)), to: key(new Date(year - 1, 11, 31)) }
    default: return { from: "", to: "" }
  }
}

export const accountingStatusLabel = (status: string) => ({
  draft: "Awaiting review", posted: "Posted", discarded: "Discarded",
  exported: "Awaiting import confirmation", imported: "Import confirmed",
}[status] || status)
